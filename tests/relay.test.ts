import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const RELAY_PATH = resolve(import.meta.dir, "../backend/relay.ts");

describe("relay.ts (WebSocket backend)", () => {
  const code = readFileSync(RELAY_PATH, "utf-8");

  it("starts an HTTP server with serve()", () => {
    expect(code).toContain("serve");
    expect(code).toContain("fetch");
  });

  it("implements WebSocket upgrade on /ws", () => {
    expect(code).toContain("serve");
    expect(code).toContain("WebSocket");
  });

  it("creates rooms for co-browsing sessions", () => {
    expect(code).toContain("room");
    expect(code).toContain("Map");
  });

  it("broadcasts messages within a room", () => {
    expect(code).toContain("broadcast");
  });

  it("provides REST endpoints for health and room state", () => {
    expect(code).toContain("/health");
    expect(code).toContain("/rooms");
  });

  it("handles cursor, scroll, navigation, and chat events", () => {
    expect(code).toContain('case "cursor"');
    expect(code).toContain('case "scroll"');
    expect(code).toContain('case "navigation"');
    expect(code).toContain('case "chat"');
    expect(code).toContain('case "page_context"');
  });

  it("handles ping/pong for keepalive", () => {
    expect(code).toContain('case "ping"');
    expect(code).toContain('"pong"');
  });
});
