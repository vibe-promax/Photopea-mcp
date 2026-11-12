# Photopea MCP on Cloudflare

Cloudflare Worker + Durable Object browser bridge for controlling Photopea through an MCP-compatible Streamable HTTP endpoint.

> **Status: early scaffold / experimental.** This repository is a Cloudflare adaptation project based on the MIT-licensed [attalla1/photopea-mcp-server](https://github.com/attalla1/photopea-mcp-server). It is not yet a complete port of the upstream toolset. The initial implementation exposes a small set of tools to validate the remote browser architecture.

## Architecture

- MCP client sends JSON-RPC requests to `/mcp` with a Bearer token.
- Cloudflare Worker validates requests and dispatches tool calls to a Durable Object.
- Open `/editor?token=YOUR_MCP_AUTH_TOKEN` in a browser. It embeds the official Photopea editor.
- The browser bridge relays scripts to Photopea using its `postMessage` interface.
- No VPS, local Node server, or fixed client IP is required.

## Deploy

1. Create a Cloudflare Worker named `photopea-mcp-cloudflare` or change `name` in `wrangler.toml`.
2. In GitHub repository settings, add Actions secrets:
   - `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit)
   - `CLOUDFLARE_ACCOUNT_ID`
   - `MCP_AUTH_TOKEN` (a long random secret used by both the MCP client and the editor page)
3. Add `MCP_AUTH_TOKEN` as a GitHub Actions secret. Use a long random token and do not commit it to the repository. The deploy workflow uploads it to the Worker after deployment.
4. Push to `main` or run the Deploy Photopea MCP workflow manually.
5. Open `https://photopea-mcp-cloudflare.<your-subdomain>.workers.dev/editor?token=<MCP_AUTH_TOKEN>` in a browser and keep the tab active.
6. Configure the MCP client with endpoint `https://photopea-mcp-cloudflare.<your-subdomain>.workers.dev/mcp` and header `Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Initial tools

- `photopea_status`
- `photopea_execute_script`
- `photopea_create_document`
- `photopea_get_document_info`

## Important limitations

- This is a first-stage bridge, not yet the upstream server's full tool inventory.
- The editor tab must remain open and active; mobile browsers may suspend background tabs.
- The current bridge keeps pending requests in Durable Object memory. A Durable Object restart can interrupt in-flight work; reconnect and retry.
- Raw script execution is powerful. Only give the MCP token to trusted clients and never expose the editor URL publicly.
- Validate Photopea's current scripting/API response behavior before relying on exports or destructive operations.

## Upstream and references

- Upstream source: https://github.com/attalla1/photopea-mcp-server
- Photopea API: https://www.photopea.com/api/
- Photopea live scripting: https://www.photopea.com/api/live
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
