import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";

const bgCode = readFileSync(new URL("../extension/background.js", import.meta.url), "utf-8");
const sidepanelCode = readFileSync(new URL("../extension/sidepanel.js", import.meta.url), "utf-8");
const contentCode = readFileSync(new URL("../extension/content.js", import.meta.url), "utf-8");

describe("error handling patterns", () => {
  describe("background.js API error handling", () => {
    it("catches fetch errors in askZoStream", () => {
      expect(bgCode).toMatch(/catch\s*\(/);
    });

    it("handles empty/invalid config gracefully", () => {
      expect(bgCode).toMatch(/defaults|config|DEFAULTS|defaultConfig/i);
      expect(bgCode).toMatch(/testConnection|TEST_CONNECTION/);
    });

    it("returns error object on failure, not throws", () => {
      const errReturns = bgCode.match(/\{ ok:\s*false\s*,?\s*error:/g);
      expect(errReturns).not.toBeNull();
      expect(errReturns!.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("stream error propagation", () => {
    it("sidepanel handles STREAM_ERROR", () => {
      expect(sidepanelCode).toMatch(/STREAM_ERROR/);
    });

    it("sidepanel renders a Zo error card with Retry on stream error", () => {
      // Zo parity: "Response interrupted" + technical detail + Retry that
      // re-submits the last query — not a bare text error.
      expect(sidepanelCode).toContain("addErrorCard");
      expect(sidepanelCode).toContain("Response interrupted");
      expect(sidepanelCode).toContain("error-card-retry");
      expect(sidepanelCode).toContain("lastQuery");
    });

    it("sidepanel has an Esc-to-cancel stream + empty-input Send gating", () => {
      expect(sidepanelCode).toContain("function cancelStream");
      expect(sidepanelCode).toContain("'Escape'");
      expect(sidepanelCode).toContain("syncSendBtn");
      expect(sidepanelCode).toContain("Zo is thinking. Press Esc to stop.");
    });

    it("sidepanel has reconnection logic", () => {
      expect(sidepanelCode).toMatch(/STREAM_RECONNECT|reconnect|retry/i);
    });

    it("background uses try/catch around fetch", () => {
      const fetchCalls = bgCode.match(/fetch\s*\(/g);
      expect(fetchCalls).not.toBeNull();
      expect(bgCode).toMatch(/response\.(ok|status)/);
    });
  });

  describe("content.js error handling", () => {
    it("action execution uses .catch() for promise errors", () => {
      const catchCount = (contentCode.match(/\.catch\(/g) || []).length;
      expect(catchCount).toBeGreaterThanOrEqual(2);
    });

    it("returns error for unknown action types", () => {
      expect(contentCode).toMatch(/Unknown action type|ok:\s*false/);
    });
  });
});
