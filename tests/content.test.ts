import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const CONTENT_PATH = resolve(import.meta.dir, "../extension/content.js");

describe("content.js", () => {
  const code = readFileSync(CONTENT_PATH, "utf-8");

  it("is valid JavaScript (no syntax errors)", () => {
    expect(() => new Function(code)).not.toThrow();
  });

  it("captures page context via captureContext", () => {
    expect(code).toContain("captureContext");
    expect(code).toContain("doc.title");
    expect(code).toContain("location.href");
    expect(code).toContain("innerText");
  });

  it("executes browser actions (click, fill, extract, scroll)", () => {
    expect(code).toContain("case 'click'");
    expect(code).toContain("case 'fill'");
    expect(code).toContain("case 'extract'");
    expect(code).toContain("case 'scroll'");
  });

  it("responds to messages from background via chrome.runtime", () => {
    expect(code).toContain("chrome.runtime.onMessage.addListener");
    expect(code).toContain("'CAPTURE_CONTEXT'");
    expect(code).toContain("'EXECUTE_ACTION'");
  });

  it("provides a waitForElement helper", () => {
    expect(code).toContain("function waitForElement");
    expect(code).toContain("MutationObserver");
  });
});