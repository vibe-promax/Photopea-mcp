import { TOOLS, getTool } from "./tools.js";
import { buildFitToLayer, buildSelectLayer, escapeString } from "./bridge/script-builder.js";

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
  { name: "photopea_fill_placeholder", description: "Fill a named placeholder layer with an image from a public HTTPS URL.", inputSchema: { type: "object", properties: { placeholder: { type: "string" }, source: { type: "string" }, fit: { type: "string", enum: ["cover", "contain"] }, mask: { type: "boolean" }, name: { type: "string" } }, required: ["placeholder", "source"], additionalProperties: false } },
  { name: "photopea_batch_process", description: "Process up to five public HTTPS images sequentially, optionally run a Photopea script on each, and return exported base64 files. This Cloudflare edition returns files instead of writing to a local folder.", inputSchema: { type: "object", properties: { inputs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 }, format: { type: "string", enum: ["png", "jpg", "webp", "psd"] }, quality: { type: "number", minimum: 1, maximum: 100 }, script: { type: "string" } }, required: ["inputs", "format"], additionalProperties: false } }
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
      try {
        const args = p.arguments || {};
        if (p.name === "photopea_open_file") {
          const file = await fetchPublicFile(String(args.source || ""));
          await bridgeLoad(env, file);
          return result(rpc.id, { content: [{ type: "text", text: "File opened in Photopea: " + file.filename }] });
        }
        if (p.name === "photopea_place_image" || p.name === "photopea_fill_placeholder") {
          const message = await placeRemoteImage(env, args, p.name === "photopea_fill_placeholder");
          return result(rpc.id, { content: [{ type: "text", text: message }] });
        }
        if (p.name === "photopea_batch_process") {
          const inputs = Array.isArray(args.inputs) ? args.inputs.slice(0, 5).map(String) : [];
          if (!inputs.length) throw new Error("Provide at least one image URL.");
          const format = String(args.format || "png");
          if (!["png", "jpg", "webp", "psd"].includes(format)) throw new Error("Unsupported batch export format.");
          const outputs: Array<{ filename: string; size: number; base64: string }> = [];
          let total = 0;
          for (const source of inputs) {
            const file = await fetchPublicFile(source);
            await bridgeLoad(env, file);
            if (args.script) await bridgeCall(env, "/execute", { script: String(args.script) });
            const quality = Number(args.quality || 90);
            const fmt = (format === "jpg" || format === "webp") ? format + ":" + (quality / 100) : format;
            const exported = await bridgeCall(env, "/execute", { script: "app.activeDocument.saveToOE('" + fmt + "');", expectFiles: true });
            if (!exported.fileBase64) throw new Error("Photopea did not return an exported file for " + file.filename);
            total += Number(exported.size || 0);
            if (total > 20 * 1024 * 1024) throw new Error("Batch export exceeded the 20 MB combined response limit.");
            const base = file.filename.replace(/\.[^.]+$/, "") || "image";
            outputs.push({ filename: base + "." + format, size: Number(exported.size || 0), base64: exported.fileBase64 });
            await bridgeCall(env, "/execute", { script: "app.activeDocument.close(2); app.echoToOE('closed');" });
          }
          return result(rpc.id, { content: [{ type: "text", text: JSON.stringify({ files: outputs }) }] });
        }
        const tool = getTool(p.name || "");
        if (!tool) return error(rpc.id, -32602, "Unknown tool");
        const built = tool.build(args);
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
    if (url.pathname === "/load" && request.method === "POST") {
      const active = this.socket || this.state.getWebSockets()[0];
      if (!active || active.readyState !== WebSocket.OPEN || !(await this.state.storage.get<boolean>("ready"))) return json({ ok: false, error: "Photopea is not connected and ready." }, 503);
      const bytes = new Uint8Array(await request.arrayBuffer());
      const filename = request.headers.get("x-photopea-filename") || "photopea-file";
      if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) return json({ ok: false, error: "File must be between 1 byte and 25 MB." }, 413);
      const id = crypto.randomUUID();
      const frame = new Uint8Array(36 + bytes.byteLength);
      for (let i = 0; i < 36; i++) frame[i] = id.charCodeAt(i);
      frame.set(bytes, 36);
      const outcome = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Photopea file load timed out.")); }, 60000);
        this.pending.set(id, { resolve, reject, timer });
        try { active.send(frame.buffer as ArrayBuffer); }
        catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error("Could not send file to Photopea.")); }
      }).catch(e => ({ error: e instanceof Error ? e.message : "File load failed." }));
      if (outcome?.error) return json({ ok: false, error: outcome.error }, 504);
      return json({ ok: true, result: outcome });
    }
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

async function fetchPublicFile(source: string): Promise<{ filename: string; bytes: ArrayBuffer }> {
  let url: URL;
  try { url = new URL(source); } catch { throw new Error("Provide a valid public HTTPS file URL. Local file paths are not supported."); }
  const safe = (u: URL) => {
    const h = u.hostname.toLowerCase();
    const parts = h.split(".");
    const ip = parts.length === 4 && parts.every(v => /^\\d+$/.test(v) && Number(v) >= 0 && Number(v) <= 255) ? parts.map(Number) : null;
    const privateIp = !!ip && (ip[0] === 0 || ip[0] === 10 || ip[0] === 127 || (ip[0] === 169 && ip[1] === 254) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168) || ip[0] >= 224);
    return u.protocol === "https:" && (u.port === "" || u.port === "443") && !u.username && !u.password && !h.startsWith("[") && h !== "localhost" && !h.endsWith(".local") && !h.endsWith(".internal") && !privateIp;
  };
  if (!safe(url)) throw new Error("Only public HTTPS URLs are accepted; local and private network addresses are blocked.");
  let response: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(url.toString(), { redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("The file host returned an invalid redirect.");
    url = new URL(location, url);
    if (!safe(url)) throw new Error("Redirect to a private or non-HTTPS URL was blocked.");
  }
  if (!response || !response.ok) throw new Error("Could not download file (HTTP " + (response?.status || "unknown") + ").");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 25 * 1024 * 1024) throw new Error("The file exceeds the 25 MB transfer limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("The file exceeds the 25 MB transfer limit.");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let filename = url.pathname.split("/").pop() || "photopea-file";
  try { filename = decodeURIComponent(filename); } catch { /* retain the encoded filename */ }
  return { filename, bytes: bytes.buffer as ArrayBuffer };
}
async function bridgeLoad(env: Env, file: { filename: string; bytes: ArrayBuffer }): Promise<any> {
  const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
  const response = await stub.fetch("https://bridge.internal/load", {
    method: "POST",
    headers: { "x-photopea-filename": file.filename, "content-type": "application/octet-stream" },
    body: file.bytes
  });
  const payload = await response.json() as { ok: boolean; result?: any; error?: string };
  if (!response.ok || !payload.ok || payload.result?.error) throw new Error(payload.error || payload.result?.error || "Photopea file transfer failed.");
  return payload.result || {};
}
async function bridgeCall(env: Env, path: string, body: unknown): Promise<any> {
  const stub = env.PHOTOPEA_BRIDGE.get(env.PHOTOPEA_BRIDGE.idFromName("shared-editor"));
  const response = await stub.fetch("https://bridge.internal" + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const payload = await response.json() as { ok: boolean; result?: any; error?: string };
  if (!response.ok || !payload.ok || payload.result?.error) throw new Error(payload.error || payload.result?.error || "Photopea bridge request failed.");
  return payload.result || {};
}
async function placeRemoteImage(env: Env, args: Record<string, unknown>, fill: boolean): Promise<string> {
  const source = String(args.source || "");
  const file = await fetchPublicFile(source);
  const docResult = await bridgeCall(env, "/execute", { script: "app.echoToOE(app.activeDocument ? app.activeDocument.name : '');" });
  const docName = String(docResult.data || "");
  if (!docName) throw new Error("Open or create a target document before placing an image.");
  if (fill) {
    await bridgeCall(env, "/execute", { script: buildSelectLayer({ target: String(args.placeholder || "") }) });
  }
  await bridgeLoad(env, file);
  const lines = [
    "var _targetDoc=app.documents.getByName('" + escapeString(docName) + "');",
    "var _sourceDoc=app.activeDocument;",
    "_sourceDoc.selection.selectAll();",
    "_sourceDoc.selection.copy(true);",
    "_sourceDoc.close(2);",
    "app.activeDocument=_targetDoc;",
    "app.activeDocument.paste();"
  ];
  if (args.name) lines.push("app.activeDocument.activeLayer.name='" + escapeString(String(args.name)) + "';");
  if (args.width || args.height) {
    lines.push("function _pv(v){return typeof v==='object'&&v!==null?(v.value||v.L||0):v;}");
    lines.push("var _b=app.activeDocument.activeLayer.bounds;var _w=_pv(_b[2])-_pv(_b[0]);var _h=_pv(_b[3])-_pv(_b[1]);");
    if (args.width && args.height) lines.push("var _s=Math.min(" + Number(args.width) + "/_w," + Number(args.height) + "/_h);");
    else if (args.width) lines.push("var _s=" + Number(args.width) + "/_w;");
    else lines.push("var _s=" + Number(args.height) + "/_h;");
    lines.push("if(_w>0&&_h>0)app.activeDocument.activeLayer.resize(_s*100,_s*100);");
  }
  if (args.x !== undefined || args.y !== undefined) lines.push("app.activeDocument.activeLayer.translate(" + Number(args.x || 0) + "," + Number(args.y || 0) + ");");
  if (fill) lines.push(buildFitToLayer({ placeholder: String(args.placeholder), fit: args.fit === "contain" ? "contain" : "cover", mask: args.mask !== false } as any));
  const done = await bridgeCall(env, "/execute", { script: lines.join("\n") });
  return done.data || "Image placed in the document.";
}
