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
