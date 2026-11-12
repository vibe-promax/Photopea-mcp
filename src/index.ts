import { TOOLS, getTool } from "./tools.js";
import { buildFitToLayer, escapeString } from "./bridge/script-builder.js";

export interface Env {
  PHOTOPEA_BRIDGE: DurableObjectNamespace;
  MCP_AUTH_TOKEN: string;
  ASSETS: Fetcher;
}
type Rpc = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };
const TOOL_LIST = [
  { name: "photopea_status", description: "Check whether the Photopea browser editor is connected and ready.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  ...TOOLS.map(({ build: _build, ...tool }) => tool),

  { name: "photopea_open_file", description: "Open an image or PSD from a public HTTPS URL in Photopea. Local filesystem paths are not supported on Cloudflare.", inputSchema: { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false } },
  { name: "photopea_place_image", description: "Place an image from a public HTTPS URL into the active document as a new layer.", inputSchema: { type: "object", properties: { source: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, name: { type: "string" } }, required: ["source"], additionalProperties: false } },
  { name: "photopea_fill_placeholder", description: "Fill a named placeholder layer with an image from a public HTTPS URL.", inputSchema: { type: "object", properties: { placeholder: { type: "string" }, source: { type: "string" }, fit: { type: "string", enum: ["cover", "contain"] }, mask: { type: "boolean" }, name: { type: "string" } }, required: ["placeholder", "source"], additionalProperties: false } }
];
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function result(id: Rpc["id"], value: unknown) { return json({ jsonrpc: "2.0", id: id ?? null, result: value }); }
function error(id: Rpc["id"], code: number, message: string) { return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, 400); }
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "photopea-mcp-cloudflare", version: "0.2.0", tools: TOOL_LIST.length });
    if (url.pathname === "/bridge") {
      const cookie = request.headers.get("cookie") || "";
      const token = cookie.split(";").map(v => v.trim()).find(v => v.startsWith("pp_bridge="))?.slice(10) || "";
      if (!safeEqual(decodeURIComponent(token), env.MCP_AUTH_TOKEN)) return new Response("Unauthorized", { status: 401 });
      const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
      return stub.fetch("https://bridge.internal/ws", request);
    }
    if (url.pathname === "/editor" && request.method === "GET") {
      const token = url.searchParams.get("token") || "";
      if (!safeEqual(token, env.MCP_AUTH_TOKEN)) return new Response("Unauthorized", { status: 401 });
      const asset = await env.ASSETS.fetch(new Request(new URL("/editor.html", request.url), request));
      const headers = new Headers(asset.headers);
      headers.set("cache-control", "no-store");
      headers.set("referrer-policy", "no-referrer");
      headers.append("set-cookie", "pp_bridge=" + encodeURIComponent(token) + "; Path=/bridge; Max-Age=3600; Secure; HttpOnly; SameSite=Strict");
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (url.pathname !== "/mcp" || request.method !== "POST") return new Response("Not found", { status: 404 });
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!safeEqual(auth, env.MCP_AUTH_TOKEN)) return json({ error: "Unauthorized" }, 401);
    let rpc: Rpc;
    try { rpc = await request.json() as Rpc; } catch { return error(undefined, -32700, "Invalid JSON"); }
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return error(rpc.id, -32600, "Invalid JSON-RPC request");
    if (rpc.method === "initialize") return result(rpc.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "photopea-mcp-cloudflare", version: "0.2.0" } });
    if (rpc.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (rpc.method === "ping") return result(rpc.id, {});
    if (rpc.method === "tools/list") return result(rpc.id, { tools: TOOL_LIST });
    if (rpc.method === "tools/call") {
      const p = (rpc.params || {}) as { name?: string; arguments?: Record<string, unknown> };
      if (p.name === "photopea_status") {
        const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
        const response = await stub.fetch("https://bridge.internal/status");
        return result(rpc.id, { content: [{ type: "text", text: await response.text() }] });
      }
      const tool = getTool(p.name || "");
      if (!tool) return error(rpc.id, -32602, "Unknown tool");
      try {
        const built = tool.build(p.arguments || {});
        if (!built.script || built.script.length > 200000) return error(rpc.id, -32602, "Generated script is empty or exceeds 200,000 characters");
        const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
        const response = await stub.fetch("https://bridge.internal/execute", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ script: built.script, expectFiles: !!built.expectFiles, previewMaxSize: built.previewMaxSize || 0 })
        });
        const payload = await response.json() as { ok: boolean; result?: { data?: string | null; error?: string | null; fileBase64?: string; size?: number }; error?: string };
        if (!response.ok || !payload.ok) return result(rpc.id, { isError: true, content: [{ type: "text", text: payload.error || "Photopea bridge error" }] });
        const value = payload.result || {};
        if (value.error) return result(rpc.id, { isError: true, content: [{ type: "text", text: value.error }] });
        if (value.fileBase64) {
          if (p.name === "photopea_get_preview") return result(rpc.id, { content: [{ type: "image", data: value.fileBase64, mimeType: "image/png" }] });
          return result(rpc.id, { content: [{ type: "text", text: JSON.stringify({ size: value.size, base64: value.fileBase64 }) }] });
        }
        return result(rpc.id, { content: [{ type: "text", text: value.data || "Done." }] });
      } catch (e) {
        return result(rpc.id, { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : "Photopea bridge failed" }] });
      }
    }
    return error(rpc.id, -32601, "Method not found");
  }
};

export class PhotopeaBridge {
  private state: DurableObjectState;
  private socket?: WebSocket;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(state: DurableObjectState) { this.state = state; }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.state.acceptWebSocket(server);
      this.socket = server;
      await this.state.storage.put("ready", false);
      return new Response(null, { status: 101, webSocket: client });
    }
    const active = this.socket || this.state.getWebSockets()[0];
    if (url.pathname === "/status") return json({ connected: !!active && active.readyState === WebSocket.OPEN, ready: !!(await this.state.storage.get<boolean>("ready")) });
    if (url.pathname === "/execute" && request.method === "POST") {
      if (!active || active.readyState !== WebSocket.OPEN || !(await this.state.storage.get<boolean>("ready"))) return json({ ok: false, error: "Photopea is not ready. Open /editor?token=… and wait for the bridge to show Ready." }, 503);
      const body = await request.json() as { script: string; expectFiles?: boolean; previewMaxSize?: number };
      if (typeof body.script !== "string" || !body.script.trim() || body.script.length > 200000) return json({ ok: false, error: "Script must contain 1–200,000 characters." }, 400);
      const id = crypto.randomUUID();
      const response = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Photopea timed out.")); }, body.expectFiles ? 60000 : 30000);
        this.pending.set(id, { resolve, reject, timer });
        try { active.send(JSON.stringify({ type: "execute", id, script: body.script, expectFiles: !!body.expectFiles, previewMaxSize: body.previewMaxSize || 0 })); }
        catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error("WebSocket send failed.")); }
      }).catch(e => ({ error: e instanceof Error ? e.message : "Execution failed" }));
      if (response?.error) return json({ ok: false, error: response.error }, 504);
      return json({ ok: true, result: response });
    }
    return new Response("Not found", { status: 404 });
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      const bytes = new Uint8Array(message);
      if (bytes.length < 36) return;
      const id = new TextDecoder().decode(bytes.subarray(0, 36));
      const item = this.pending.get(id);
      if (!item) return;
      clearTimeout(item.timer); this.pending.delete(id);
      const file = bytes.subarray(36);
      item.resolve({ fileBase64: toBase64(file), size: file.byteLength });
      return;
    }
    try {
      const data = JSON.parse(message) as { type: string; id?: string; success?: boolean; data?: string | null; error?: string | null; status?: string };
      if (data.type === "status") {
        await this.state.storage.put("ready", data.status === "ready");
        return;
      }
      if (data.type === "result" && data.id) {
        const item = this.pending.get(data.id);
        if (!item) return;
        clearTimeout(item.timer); this.pending.delete(data.id);
        item.resolve({ data: data.data ?? null, error: data.success === false ? data.error || "Photopea script failed." : null });
      }
    } catch { /* Ignore malformed bridge messages. */ }
  }
  async webSocketClose(socket: WebSocket) {
    if (this.socket === socket) this.socket = undefined;
    await this.state.storage.put("ready", false);
  }
  webSocketError(socket: WebSocket) { return this.webSocketClose(socket); }
}
