# Zo Co-browse Backend — WebSocket Relay

Relays co-browsing session messages between Zo and the browser extension.

## Quick Start

```bash
bun install
PORT=8091 bun run relay.ts
```

## Register as a User Service

```bash
register_user_service with mode="http", local_port=8091, entrypoint="bun run /home/workspace/Projects/zo-cobrowse/backend/relay.ts"
```

## API

### WebSocket

Connect at `ws://host:port/ws?room=<roomId>&client=<clientId>` (both optional; default `room=default`, `client` auto-generated)

Messages are JSON:
- `{ type: "page_context", url, title, dom }` — share current page
- `{ type: "action", action }` — execute a browser action
- `{ type: "cursor", x, y }` — cursor position for shared browsing
- `{ type: "chat" }` / `{ type: "text" }` — chat message
- `{ type: "scroll" }` / `{ type: "navigation" }` / `{ type: "highlight" }` — broadcast
- `{ type: "ping" }` — server replies `{ type: "pong" }`

### HTTP

- `GET /health` — service health check (rooms, connections, uptime)
- `GET /rooms` — list active rooms and participants
- `POST /rooms/:roomId/participants` — register a participant in a room

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3101` | HTTP/WebSocket server port (set by Zo user service) |

## Running

The relay serves as a WebSocket bridge for shared co-browse sessions (Ticket #15).

### Local development
```bash
bun run backend/relay.ts
```

### As a Zo user service
```bash
register_user_service mode=http local_port=3101 entrypoint='bash -c "cd /home/workspace/Projects/zo-cobrowse && bun run backend/relay.ts"'
```

## Endpoints

### `GET /health`
Health check. Returns `{ "status": "ok", "rooms": <n>, "connections": <n>, "uptime": <s> }`.

### `GET /rooms`
Lists active rooms with participant counts and names.

### `POST /rooms/:roomId/participants`
Registers a participant in a room (creates the room if absent).

### `WebSocket /ws`
WebSocket endpoint for shared sessions (`?room=<id>&client=<id>`). See `ticket-15-shared-sessions.md` for protocol.

### Example
```bash
curl http://localhost:3101/health
# => {"status":"ok","rooms":0,"connections":0,"uptime":1.23}
```
