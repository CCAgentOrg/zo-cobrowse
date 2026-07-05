import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SIDEPANEL_PATH = resolve(import.meta.dir, "../extension/sidepanel.js");

describe("sidepanel.js", () => {
  const code = readFileSync(SIDEPANEL_PATH, "utf-8");

  it("is valid JavaScript", () => {
    expect(() => new Function(code)).not.toThrow();
  });

  it("has history persistence (MAX_HISTORY, loadHistory, saveHistory)", () => {
    expect(code).toContain("MAX_HISTORY");
    expect(code).toContain("loadHistory");
    expect(code).toContain("saveHistory");
    expect(code).toContain("chrome.storage.local");
  });

  it("has new chat button and clearHistory", () => {
    expect(code).toContain("newChatBtn");
    expect(code).toContain("clearHistory");
    expect(code).toContain("NEW_CONVERSATION");
  });

  it("restores history on init", () => {
    expect(code).toContain("loadHistory()");
    expect(code).toContain("msg-system");
  });
});
