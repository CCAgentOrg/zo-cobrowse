# Zo Co-browse Backend — WebSocket Relay

Relays co-browsing session messages between Zo and the browser extension. Also serves as a Zo.space bridge for data queries.

## Quick Start

```bash
bun install
bun run relay.ts --port 8091
```

## Register as a User Service

```bash
register_user_service with mode="http", local_port=8091, entrypoint="bun run /home/workspace/Projects/zo-cobrowse/backend/relay.ts"
```

## API

### WebSocket

Connect at `ws://host:port/ws/:sessionId`

Messages are JSON:
- `{ type: "page_context", url, title, dom }` — share current page
- `{ type: "query", text }` — ask Zo about the page
- `{ type: "action", action }` — execute a browser action
- `{ type: "cursor", x, y }` — cursor position for shared browsing

### HTTP

- `GET /health` — service health check
- `POST /query` — DuckDB read query (same as zo.space API)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port (set by Zo user service) |
| `ZO_API_KEY` | Yes | — | API key for Zo at api.zo.computer |
| `ZO_API_URL` | No | `https://api.zo.computer` | Zo API base URL |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |

## Running

The relay serves as a WebSocket bridge for shared co-browse sessions (Ticket #15).

### Local development
```bash
ZO_API_KEY=sk_xxx bun run backend/relay.ts
```

### As a Zo user service
```bash
register_user_service mode=http local_port=3000 entrypoint='bash -c "cd /home/workspace/Projects/zo-cobrowse && bun run backend/relay.ts"' env_vars='{"ZO_API_KEY":"sk_xxx"}'
```

## Endpoints

### `GET /health`
Health check. Returns `{ "status": "ok" }` if the relay is alive.

### `GET /`
Returns the Zo Co-browse research page (demonstration of capabilities).

### `WebSocket /ws`
WebSocket endpoint for shared sessions. See `ticket-15-shared-sessions.md` for protocol.

### Example
```bash
curl http://localhost:3000/health
# => {"status":"ok"}
```
