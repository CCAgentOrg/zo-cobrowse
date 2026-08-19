import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { Action, ActionType } from "./schemas/actions";

const bgCode = readFileSync(resolve(import.meta.dir, "../extension/background.js"), "utf-8");
const contentCode = readFileSync(resolve(import.meta.dir, "../extension/content.js"), "utf-8");
const actionTypes: ActionType[] = ["navigate", "click", "fill", "extract", "scroll", "wait", "done"];

describe("action schema", () => {
  it("validates all action types against schema", () => {
    const payload: Record<string, Record<string, string>> = {
      navigate: { url: "https://example.com" },
      click: { selector: "#btn" },
      fill: { selector: "#input", value: "text" },
      extract: { selector: ".content" },
      scroll: { direction: "down" },
      wait: { ms: 1000 },
      done: { response: "done" },
    };
    for (const t of actionTypes) {
      const result = Action.safeParse({ type: t, ...(payload[t] || {}) });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown action types", () => {
    const result = Action.safeParse({ type: "fly" });
    expect(result.success).toBe(false);
  });

  it("validates navigate with url", () => {
    const result = Action.safeParse({ type: "navigate", url: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("validates click with selector", () => {
    const result = Action.safeParse({ type: "click", selector: "#btn" });
    expect(result.success).toBe(true);
  });

  it("validates fill with selector and value", () => {
    const result = Action.safeParse({ type: "fill", selector: "#input", value: "hello" });
    expect(result.success).toBe(true);
  });

  it("validates extract with selector and attribute", () => {
    const result = Action.safeParse({ type: "extract", selector: "h1", attribute: "textContent" });
    expect(result.success).toBe(true);
  });

  it("validates scroll with direction", () => {
    const result = Action.safeParse({ type: "scroll", direction: "down" });
    expect(result.success).toBe(true);
  });

  it("validates wait with ms", () => {
    const result = Action.safeParse({ type: "wait", ms: 1000 });
    expect(result.success).toBe(true);
  });

  it("validates done with response", () => {
    const result = Action.safeParse({ type: "done", response: "finished" });
    expect(result.success).toBe(true);
  });

  it("validates the context-only pull actions (#24)", () => {
    expect(Action.safeParse({ type: "read_tab", ref: "T1" }).success).toBe(true);
    expect(Action.safeParse({ type: "read_page" }).success).toBe(true);
    expect(Action.safeParse({ type: "get_dom" }).success).toBe(true);
    expect(Action.safeParse({ type: "get_form" }).success).toBe(true);
    // read_tab without a usable ref is NOT a valid action
    expect(Action.safeParse({ type: "read_tab" }).success).toBe(false);
  });
});

describe("background.js action execution", () => {
  it("has executeActions function", () => {
    expect(bgCode).toMatch(/async function executeActions/);
  });

  it("has executeDomAction inline script", () => {
    expect(bgCode).toMatch(/function executeDomAction/);
  });

  it("handles navigate via chrome.tabs.update", () => {
    expect(bgCode).toMatch(/chrome\.tabs\.update/);
  });
});

describe("content.js action execution", () => {
  it("has executeAction function", () => {
    expect(contentCode).toMatch(/async function executeAction/);
  });

  it("handles click action", () => {
    expect(contentCode).toMatch(/case 'click'/);
  });

  it("handles fill action", () => {
    expect(contentCode).toMatch(/case 'fill'/);
  });

  it("handles extract action", () => {
    expect(contentCode).toMatch(/case 'extract'/);
  });

  it("handles scroll action", () => {
    expect(contentCode).toMatch(/case 'scroll'/);
  });

  it("handles wait action", () => {
    expect(contentCode).toMatch(/case 'wait'/);
  });

  it("returns error for unknown action type", () => {
    expect(contentCode).toMatch(/Unknown action type/);
  });
});
