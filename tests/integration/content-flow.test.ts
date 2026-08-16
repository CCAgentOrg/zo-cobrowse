// Integration: the REAL content.js, imported as a module after its page
// globals (document/window/location/CSS/Event) are pointed at a happy-dom
// window and `chrome` at a tab message target — exactly how background.js
// addresses it via chrome.tabs.sendMessage. Exercises the full message
// contract: tier-gated capture, every action type, and clean error paths.
//
// (content.js is an IIFE with no exports; importing it runs the listener
// registration against whatever globals are installed at import time, so
// each test file imports it with its own cache-busting query string.)

import { describe, it, expect, beforeAll } from "bun:test";
import { Window } from "happy-dom";
import { createTabTarget, stubNonZeroRects } from "../helpers/chrome-mock.ts";

/** Point bare browser globals at a happy-dom window + tab target (defineProperty: Bun owns some). */
function setPageGlobals(win: any, chromeObj: any) {
  const g: any = globalThis;
  const pairs: Record<string, any> = {
    chrome: chromeObj,
    document: win.document,
    window: win,
    location: win.location,
    CSS: win.CSS,
    Event: win.Event,
    MutationObserver: win.MutationObserver,
  };
  for (const [name, value] of Object.entries(pairs)) {
    Object.defineProperty(g, name, { value, configurable: true, writable: true });
  }
}

describe("content.js — full-script message flow", () => {
  let win: any;
  let target: ReturnType<typeof createTabTarget>;
  let events: string[];

  beforeAll(async () => {
    win = new Window({ url: "https://example.test/article" });
    win.document.write(`<!DOCTYPE html><html><head><title>Test Article</title></head><body>
      <main>
        <h1>Article Heading</h1>
        <p>Some visible article text for capture tests.</p>
        <form>
          <input id="name" name="name" placeholder="Full name" />
          <input id="email" name="email" type="email" />
          <input type="hidden" name="secret" value="h" />
          <select id="plan" name="plan"><option value="pro">Pro</option></select>
          <button id="submit-btn" type="button" data-kind="primary">Submit</button>
        </form>
        <a href="https://example.test/next">Next page</a>
      </main>
    </body></html>`);
    stubNonZeroRects(win);
    events = [];
    win.document.querySelector("#submit-btn").addEventListener("click", () => events.push("submit-click"));
    for (const el of win.document.querySelectorAll("input, select")) {
      el.addEventListener("input", () => events.push(`input:${el.id}:${el.value}`));
      el.addEventListener("change", () => events.push(`change:${el.id}:${el.value}`));
    }
    target = createTabTarget();
    setPageGlobals(win, target.chrome);
    await import("../../extension/content.js?file=content-flow");
  });

  describe("CAPTURE_CONTEXT tier gating", () => {
    it("tier 0: URL/title/viewport only", async () => {
      const ctx = await target.dispatch({ type: "CAPTURE_CONTEXT", tier: 0 });
      expect(ctx.url).toBe("https://example.test/article");
      expect(ctx.title).toBe("Test Article");
      expect(ctx.viewport).toEqual({ w: win.innerWidth, h: win.innerHeight });
      expect(ctx.visibleText).toBeUndefined();
      expect(ctx.formFields).toBeUndefined();
    });

    it("tier 1: adds visibleText from <main>, no elements", async () => {
      const ctx = await target.dispatch({ type: "CAPTURE_CONTEXT", tier: 1 });
      expect(ctx.visibleText).toContain("Some visible article text");
      expect(ctx.formFields).toBeUndefined();
    });

    it("tier 2: adds form fields + clickables with selectors; hidden and zero-rect elements excluded", async () => {
      // Make one field invisible the way the capture path checks (zero rect).
      const email = win.document.querySelector("#email");
      email.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 });
      const ctx = await target.dispatch({ type: "CAPTURE_CONTEXT", tier: 2 });
      const names = ctx.formFields.map((f: any) => f.selector);
      expect(names).toContain("#name");
      expect(names).toContain("#plan");
      expect(names).not.toContain("#email"); // zero-rect → filtered
      expect(ctx.formFields.some((f: any) => f.name === "secret")).toBe(false); // hidden input → filtered
      const clickables = ctx.clickable.map((c: any) => c.text);
      expect(clickables).toContain("Submit");
      expect(clickables).toContain("Next page");
      expect(ctx.documentSize).toBeTruthy();
    });
  });

  describe("EXECUTE_ACTION semantics", () => {
    it("fill sets the value and fires input+change", async () => {
      const res = await target.dispatch({ type: "EXECUTE_ACTION", action: { type: "fill", selector: "#name", value: "Jane Doe" } });
      expect(res).toEqual({ ok: true, type: "fill" });
      expect(win.document.querySelector("#name").value).toBe("Jane Doe");
      expect(events).toContain("input:name:Jane Doe");
      expect(events).toContain("change:name:Jane Doe");
    });

    it("click fires the element's listeners", async () => {
      const res = await target.dispatch({ type: "EXECUTE_ACTION", action: { type: "click", selector: "#submit-btn" } });
      expect(res).toEqual({ ok: true, type: "click" });
      expect(events).toContain("submit-click");
    });

    it("extract returns textContent, or an attribute when asked", async () => {
      const res = await target.dispatch({ type: "EXECUTE_ACTION", action: { type: "extract", selector: "#submit-btn" } });
      expect(res.ok).toBe(true);
      expect(res.value).toBe("Submit");
      const attr = await target.dispatch({ type: "EXECUTE_ACTION", action: { type: "extract", selector: "#submit-btn", attribute: "data-kind" } });
      expect(attr.value).toBe("primary");
    });

    it("scroll / wait / navigate / done respond ok without erroring", async () => {
      for (const action of [
        { type: "scroll", direction: "down", amount: 300 },
        { type: "wait", ms: 10 },
        { type: "navigate", url: "https://example.test/next" },
        { type: "done", response: "finished" },
      ]) {
        const res = await target.dispatch({ type: "EXECUTE_ACTION", action });
        expect(res.ok).toBe(true);
        expect(res.type).toBe(action.type);
      }
    });

    it("an actions[] array runs all and aggregates results", async () => {
      const res = await target.dispatch({
        type: "EXECUTE_ACTION",
        actions: [
          { type: "fill", selector: "#plan", value: "pro" },
          { type: "click", selector: "#submit-btn" },
        ],
      });
      expect(res.ok).toBe(true);
      expect(res.results.map((r: any) => r.type)).toEqual(["fill", "click"]);
    });

    it("unknown action type fails cleanly", async () => {
      const res = await target.dispatch({ type: "EXECUTE_ACTION", action: { type: "warp", selector: "#name" } });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Unknown action type: warp");
    });

    it("missing element rejects into a clean error response (after the 5s waitForElement timeout)", async () => {
      const res = await target.dispatch({ type: "EXECUTE_ACTION", action: { type: "click", selector: "#not-there" } });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("#not-there");
    }, 7000);
  });

  describe("message contract edges", () => {
    it("unknown message type responds cleanly (no hanging promise)", async () => {
      const res = await target.dispatch({ type: "SOMETHING_ELSE" });
      expect(res).toEqual({ ok: false, error: "Unknown request type: SOMETHING_ELSE" });
    });
  });
});
