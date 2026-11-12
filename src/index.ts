export interface Env {
  PHOTOPEA_BRIDGE: DurableObjectNamespace;
  MCP_AUTH_TOKEN: string;
  BRIDGE_SESSION_SECRET: string;
}

type JsonRpc = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };

const TOOLS = [
  { name: "photopea_status", description: "Check whether the Photopea browser bridge is connected.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "photopea_execute_script", description: "Execute JavaScript in the active Photopea document. Scripts run in the user's browser.", inputSchema: { type: "object", properties: { script: { type: "string", description: "Photopea scripting API JavaScript." } }, required: ["script"], additionalProperties: false } },
  { name: "photopea_create_document", description: "Create a new Photopea document.", inputSchema: { type: "object", properties: { name: { type: "string" }, width: { type: "integer", minimum: 1, maximum: 12000 }, height: { type: "integer", minimum: 1, maximum: 12000 }, dpi: { type: "integer", minimum: 1, maximum: 1200 } }, required: ["width", "height"], additionalProperties: false } },
  { name: "photopea_get_document_info", description: "Read basic information about the active Photopea document.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function rpcResult(id: string | number | undefined, result: unknown) { return json({ jsonrpc: "2.0", id: id ?? null, result }); }
function rpcError(id: string | number | undefined, code: number, message: string) { return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, 400); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "photopea-mcp-cloudflare", version: "0.1.0" });
    if (url.pathname === "/bridge") {
      const token = url.searchParams.get("token") || "";
      if (!constantTimeEqual(token, env.MCP_AUTH_TOKEN)) return new Response("Unauthorized", { status: 401 });
      const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
      return stub.fetch("https://bridge.internal/ws", request);
    }
    if (url.pathname === "/editor" && request.method === "GET") {
      const token = url.searchParams.get("token") || "";
      if (!constantTimeEqual(token, env.MCP_AUTH_TOKEN)) return new Response("Unauthorized", { status: 401 });
      return new Response(editorHtml(token), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });
    }
    if (url.pathname !== "/mcp" || request.method !== "POST") return new Response("Not found", { status: 404 });
    const auth = request.headers.get("authorization") || "";
    if (!constantTimeEqual(auth.replace(/^Bearer\s+/i, ""), env.MCP_AUTH_TOKEN)) return json({ error: "Unauthorized" }, 401);
    let message: JsonRpc;
    try { message = await request.json() as JsonRpc; } catch { return rpcError(undefined, -32700, "Invalid JSON"); }
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message.id, -32600, "Invalid JSON-RPC request");
    if (message.method === "initialize") {
      return rpcResult(message.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "photopea-mcp-cloudflare", version: "0.1.0" } });
    }
    if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (message.method === "ping") return rpcResult(message.id, {});
    if (message.method === "tools/list") return rpcResult(message.id, { tools: TOOLS });
    if (message.method === "tools/call") {
      const params = (message.params || {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return rpcError(message.id, -32602, "Unknown tool");
      try {
        const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
        const response = await stub.fetch("https://bridge.internal/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: params.name, args: params.arguments || {} }) });
        const payload = await response.json() as { ok: boolean; result?: unknown; error?: string };
        if (!response.ok || !payload.ok) return rpcResult(message.id, { isError: true, content: [{ type: "text", text: payload.error || "Photopea bridge error" }] });
        return rpcResult(message.id, { content: [{ type: "text", text: typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result) }] });
      } catch (error) {
        return rpcResult(message.id, { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Bridge unavailable" }] });
      }
    }
    return rpcError(message.id, -32601, "Method not found");
  }
};

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class PhotopeaBridge {
  private state: DurableObjectState;
  private socket?: WebSocket;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private ready = false;
  constructor(state: DurableObjectState) { this.state = state; }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1];
      this.state.acceptWebSocket(server); this.socket = server; this.ready = false;
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/execute" && request.method === "POST") {
      if (!this.socket || !this.ready || this.socket.readyState !== WebSocket.OPEN) return json({ ok: false, error: "Photopea browser is not connected. Open the /editor page and keep it active." }, 503);
      const body = await request.json() as { tool: string; args: Record<string, unknown> };
      if (body.tool === "photopea_status") return json({ ok: true, result: { connected: true, ready: this.ready } });
      let script = "";
      if (body.tool === "photopea_execute_script") {
        if (typeof body.args.script !== "string" || body.args.script.length > 20000) return json({ ok: false, error: "script must be a string of at most 20,000 characters" }, 400);
        script = body.args.script as string;
      } else if (body.tool === "photopea_create_document") {
        const w = Number(body.args.width), h = Number(body.args.height), dpi = Number(body.args.dpi || 72);
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 12000 || h > 12000) return json({ ok: false, error: "width and height must be integers between 1 and 12000" }, 400);
        const name = JSON.stringify(String(body.args.name || "Untitled"));
        script = `app.documents.add(${w}, ${h}, ${dpi}, ${name}, "RGB", "white"); app.echoToOE("Document created: " + app.activeDocument.name);`;
      } else if (body.tool === "photopea_get_document_info") {
        script = `if (!app.documents.length) { app.echoToOE("No document is open"); } else { var d=app.activeDocument; app.echoToOE(JSON.stringify({name:d.name,width:d.width,height:d.height,resolution:d.resolution,layers:d.layers.length})); }`;
      }
      if (!script) return json({ ok: false, error: "Unsupported tool" }, 400);
      const id = crypto.randomUUID();
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Photopea script timed out after 30 seconds")); }, 30000);
        this.pending.set(id, { resolve, reject, timer });
        try { this.socket!.send(JSON.stringify({ type: "EXECUTE", id, script })); }
        catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error("WebSocket send failed")); }
      }).catch(e => ({ __error: e instanceof Error ? e.message : "Execution failed" }));
      if (result && typeof result === "object" && "__error" in result) return json({ ok: false, error: (result as {__error:string}).__error }, 504);
      return json({ ok: true, result });
    }
    return new Response("Not found", { status: 404 });
  }
  webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as { type: string; id?: string; result?: unknown };
      if (data.type === "READY") { this.ready = true; return; }
      if (data.type === "RESULT" && data.id) { const item = this.pending.get(data.id); if (item) { clearTimeout(item.timer); this.pending.delete(data.id); item.resolve(data.result); } }
    } catch { /* Ignore malformed bridge messages. */ }
  }
  webSocketClose(socket: WebSocket) { if (this.socket === socket) { this.socket = undefined; this.ready = false; } }
  webSocketError(socket: WebSocket) { this.webSocketClose(socket); }
}

function editorHtml(token: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Photopea MCP Bridge</title><style>*{box-sizing:border-box}body{margin:0;background:#101827;color:#fff;font:14px system-ui}header{height:44px;padding:12px 16px;background:#0b1220}#status{color:#ffd84d}iframe{width:100%;height:calc(100dvh - 44px);border:0}</style></head><body><header>Photopea MCP Bridge · <span id="status">Connecting…</span></header><iframe id="photopea" src="https://www.photopea.com" allow="clipboard-read; clipboard-write"></iframe><script>
const token=${JSON.stringify(token)}, status=document.getElementById('status'), frame=document.getElementById('photopea');
let ws; function connect(){const proto=location.protocol==='https:'?'wss:':'ws:';ws=new WebSocket(proto+'//'+location.host+'/bridge?token='+encodeURIComponent(token));ws.onopen=()=>{status.textContent='Connected · waiting for Photopea';};ws.onclose=()=>{status.textContent='Disconnected · reload to reconnect';};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='EXECUTE'){try{frame.contentWindow.postMessage(m.script,'https://www.photopea.com');}catch(err){ws.send(JSON.stringify({type:'RESULT',id:m.id,result:String(err)}));}window.__activeJob=m.id;}};}
window.addEventListener('message',e=>{if(e.source!==frame.contentWindow)return; if(typeof e.data==='string' && window.__activeJob){ws?.send(JSON.stringify({type:'RESULT',id:window.__activeJob,result:e.data}));window.__activeJob=null;}});
frame.addEventListener('load',()=>{if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'READY'}));status.textContent='Ready';}});
connect();
</script></body></html>`;
}
