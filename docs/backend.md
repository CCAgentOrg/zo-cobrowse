# Backend Relay

An **optional** HTTP + WebSocket service that relays co-browsing session
messages between Zo and the browser extension — used for **multi-participant**
co-browsing (Ticket #15). It is **not required** for single-user co-browsing.

## Quick start

```bash
cd backend
bun install
PORT=8091 bun run relay.ts
```

Register as a Zo user service:

```bash
register_user_service with mode="http", local_port=8091, entrypoint="bun run /path/to/zo-cobrowse/backend/relay.ts"
```

## API

### WebSocket — `/ws`

Connect at `ws://host:port/ws?room=<roomId>&client=<clientId>` (both optional;
default `room=default`, `client` auto-generated).

Messages are JSON:

| Message type | Purpose |
|--------------|---------|
| `{ type: "page_context", url, title, dom }` | Share the current page |
| `{ type: "action", action }` | Execute a browser action |
| `{ type: "cursor", x, y }` | Cursor position for shared browsing |
| `{ type: "chat" }` / `{ type: "text" }` | Chat message |
| `{ type: "scroll" }` / `{ type: "navigation" }` / `{ type: "highlight" }` | Broadcast |
| `{ type: "ping" }` | Server replies `{ type: "pong" }` |

### HTTP

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Service health check → `{ status, rooms, connections, uptime }` |
| `GET /rooms` | List active rooms and participants |
| `POST /rooms/:roomId/participants` | Register a participant in a room (creates it if absent) |

Example:

```bash
curl http://localhost:3101/health
# => {"status":"ok","rooms":0,"connections":0,"uptime":1.23}
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3101` | HTTP/WebSocket server port (set by the Zo user service) |

## Status

The relay exists for shared sessions, but **extension integration is not yet
wired up** — the extension still talks directly to Zo and Zo.space. Multi-
participant co-browsing is on the roadmap (see [Roadmap](roadmap)).
