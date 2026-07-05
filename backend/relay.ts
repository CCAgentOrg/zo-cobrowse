// Zo Co-browse Backend — WebSocket Relay Service
//
// Run as a Zo User Service (mode: "http").
// Relays co-browsing session messages, manages room state,
// and provides an API for the extension to query Zo via MCP/data channels.
//
// The extension connects here for:
//  - Real-time co-browsing sessions (multiple participants)
//  - Zo.space data querying (DuckDB, research, etc.)
//  - Session persistence

import { serve } from "bun";

const PORT = parseInt(process.env.PORT || "3101");

// ---- State ----
const rooms = new Map(); // roomId -> { participants: Map(ws -> {id, name}), created: Date }
const connections = new Set(); // all connected WebSocket clients

// ---- Helpers ----
function broadcast(roomId, message, exclude = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = typeof message === "string" ? message : JSON.stringify(message);
  for (const [ws] of room.participants) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(typeof data === "string" ? data : JSON.stringify(data));
  }
}

// ---- HTTP Server ----
const server = serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // ---- WebSocket upgrade ----
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room") || "default";
      const clientId = url.searchParams.get("client") || crypto.randomUUID();
      const success = server.upgrade(req, { data: { roomId, clientId } });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // ---- REST API ----

    // GET /health — simple health check
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        rooms: rooms.size,
        connections: connections.size,
        uptime: process.uptime(),
      });
    }

    // GET /rooms — list active rooms
    if (url.pathname === "/rooms") {
      const summary = [];
      for (const [id, room] of rooms) {
        summary.push({
          id,
          participants: room.participants.size,
          created: room.created.toISOString(),
          participantsList: [...room.participants.values()].map((p) => p.name || p.id),
        });
      }
      return Response.json({ rooms: summary });
    }

    // POST /rooms/:roomId/participants — add a participant
    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)\/participants$/);
    if (req.method === "POST" && roomMatch) {
      const roomId = roomMatch[1];
      let room = rooms.get(roomId);
      if (!room) {
        room = { participants: new Map(), created: new Date() };
        rooms.set(roomId, room);
      }
      // This would be used by the server to register participants
      return Response.json({ roomId, participantCount: room.participants.size });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { roomId, clientId } = ws.data;
      connections.add(ws);

      let room = rooms.get(roomId);
      if (!room) {
        room = { participants: new Map(), created: new Date() };
        rooms.set(roomId, room);
      }
      room.participants.set(ws, { id: clientId, name: `User-${clientId.slice(0, 6)}` });

      sendTo(ws, { type: "connected", clientId, roomId, participants: room.participants.size });
      broadcast(roomId, {
        type: "participant_joined",
        clientId,
        participants: room.participants.size,
      }, ws);

      console.log(`[cobrowse] ${clientId} joined room ${roomId} (${room.participants.size} participants)`);
    },

    message(ws, raw) {
      const { roomId, clientId } = ws.data;
      let msg;
      try { msg = JSON.parse(raw); } catch { msg = { type: "text", content: raw }; }

      // Attach sender info
      msg.clientId = clientId;
      msg.timestamp = Date.now();

      switch (msg.type) {
        case "cursor":        // Cursor position broadcast
        case "scroll":
        case "navigation":
        case "highlight":
          broadcast(roomId, msg, ws);
          break;

        case "text":
        case "chat":
          broadcast(roomId, msg, ws);
          break;

        case "action":
          // One participant performing an action — broadcast to all but sender
          broadcast(roomId, msg, ws);
          break;

        case "page_context":
          // Share current page info with other co-browsers
          broadcast(roomId, msg, ws);
          break;

        case "ping":
          sendTo(ws, { type: "pong", timestamp: Date.now() });
          break;

        default:
          broadcast(roomId, msg, ws);
      }
    },

    close(ws) {
      const { roomId, clientId } = ws.data;
      connections.delete(ws);

      const room = rooms.get(roomId);
      if (room) {
        room.participants.delete(ws);
        broadcast(roomId, {
          type: "participant_left",
          clientId,
          participants: room.participants.size,
        });

        if (room.participants.size === 0) {
          rooms.delete(roomId);
          console.log(`[cobrowse] room ${roomId} closed (empty)`);
        }
      }
      console.log(`[cobrowse] ${clientId} left room ${roomId}`);
    },

    drain(ws) {
      // Backpressure — client too slow
      console.warn(`[cobrowse] drain: ${ws.data.clientId}`);
    },
  },
});

console.log(`[cobrowse] WebSocket relay running on port ${PORT}`);
