# Photopea MCP — Cloudflare edition

A Cloudflare Workers adaptation of the MIT-licensed [attalla1/photopea-mcp-server](https://github.com/attalla1/photopea-mcp-server). It exposes an MCP Streamable HTTP endpoint and connects it to the official Photopea editor running in a browser tab.

**Current state: experimental port.** The upstream script builders and all 46 editing tool names are represented. Cloudflare-specific adaptations replace local filesystem paths with public HTTPS file URLs and return exported files as base64; behavior still needs end-to-end validation against the live Photopea editor.

## Architecture

- `/mcp`: JSON-RPC MCP endpoint (currently public, with no authentication).
- `/editor`: serves the adapted upstream browser bridge UI and embeds Photopea.
- `/bridge`: same-origin WebSocket used by the editor bridge.
- Durable Object: keeps the browser WebSocket and correlates script responses and binary exports.
- Photopea performs image editing in the browser. Cloudflare routes commands and results; no VPS, local Node server, fixed IP, or IP allowlisting is required.

## Tools currently exposed

**Documents:** create, get info, resize, close, crop, resize canvas, trim, rotate canvas.

**Layers:** add layer, add fill layer, delete, select, set properties, move, duplicate, reorder, group, ungroup, get layer tree, layer mask, clipping mask, adjustment layer, merge, layer styles.

**Text and shapes:** add text, edit text, add shape.

**Image operations:** apply adjustment, apply filter, transform layer, add gradient, make/modify/fill/clear selection.

**Output and utilities:** open file from public HTTPS URL, place image, fill placeholder, get preview (image result), export image (base64 result), batch process (up to five URLs, base64 output), run script, undo, redo, load font, list fonts.

The API exposes 46 editing tools plus `photopea_status`. Tool schemas are published by `tools/list`.

## Deployment

### GitHub Actions secrets

In this repository, open **Settings → Secrets and variables → Actions** and add:

- `CLOUDFLARE_API_TOKEN` — token with permission to edit Workers scripts and manage Worker secrets.
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.

The workflow deploys the Worker. A push to `main` starts deployment. Only the Cloudflare API token and account ID are required.

### Cloudflare

The Worker name is set in `wrangler.toml` as `photopea-mcp-cloudflare`. Change it if you prefer a different name. The project uses a SQLite-backed Durable Object migration and static assets from `public/`.

### Connect

After a successful deployment, use:

- Editor: `https://photopea-mcp-cloudflare.<your-subdomain>.workers.dev/editor`
- MCP endpoint: `https://photopea-mcp-cloudflare.<your-subdomain>.workers.dev/mcp`

**Security warning:** Authentication is intentionally disabled for this initial test deployment. Anyone who discovers the Worker URL can call the MCP tools and control the shared Photopea editor session. Do not use sensitive files or expose the URL publicly. Add authentication before production use. Open the editor URL and wait for the bridge to show **Ready**. Keep that tab open while using the MCP tools.

## Important constraints

- The browser editor must remain open. Android may suspend background tabs; keep Photopea in the foreground during long operations.
- Preview returns image content. Export currently returns base64 file data in a text result; large PSD exports can exceed practical MCP response sizes.
- Local filesystem paths are not available in Cloudflare Workers. File-open, image-placement, placeholder-fill, and batch tools accept public HTTPS URLs only. Batch processing is limited to five inputs and a 20 MB combined export response.
- Not every Photopea feature is scriptable. Custom scripts have broad access to the open document and can make destructive changes.
- The browser bridge is single-editor/single-session in this initial version. Multiple independent users need separate session routing before public multi-user use.
- Authentication is currently disabled by design for initial testing; the MCP endpoint and editor bridge are publicly accessible. Do not treat this as production-ready.

## Source and API references

- Upstream source: https://github.com/attalla1/photopea-mcp-server
- Photopea API: https://www.photopea.com/api/
- Photopea live scripting: https://www.photopea.com/api/live
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
