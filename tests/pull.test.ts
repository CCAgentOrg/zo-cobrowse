import { describe, it, expect } from "bun:test";
import {
  PULL_ACTION_NAMES,
  MAX_PULL_CYCLES,
  DOM_CLICKABLE_CAP,
  DOM_FORM_CAP,
  pullTier,
  pullCaptureOpts,
  extractPullRequests,
  pullHash,
  buildPullFollowUp,
} from "../extension/lib/pull.js";
import { MAX_READ_TAB_CYCLES } from "../extension/lib/tab-contexts.js";
import { CONTEXT_ACTION_NAMES, ACTION_SCHEMA_COMPACT } from "../extension/lib/modes.js";
import { PullRequestSchema, FollowUpSchema, PullCaptureSchema } from "./schemas/pull.js";

describe("pull protocol — constants", () => {
  it("lists the four context-only pull actions, mirroring modes.js", () => {
    expect([...PULL_ACTION_NAMES].sort()).toEqual(["get_dom", "get_form", "read_page", "read_tab"]);
    expect(PULL_ACTION_NAMES).toEqual(CONTEXT_ACTION_NAMES);
  });

  it("shares the read_tab cycle budget (one loop, one budget)", () => {
    expect(MAX_PULL_CYCLES).toBe(MAX_READ_TAB_CYCLES);
    expect(MAX_PULL_CYCLES).toBe(3);
  });

  it("teaches every pull action in ACTION_SCHEMA_COMPACT", () => {
    for (const name of PULL_ACTION_NAMES) expect(ACTION_SCHEMA_COMPACT).toContain(name);
  });
});

describe("pullTier / pullCaptureOpts", () => {
  it("maps each pull kind to its capture tier", () => {
    expect(pullTier("read_page")).toBe(1);
    expect(pullTier("get_dom")).toBe(2);
    expect(pullTier("get_form")).toBe(2);
  });

  it("maps each pull kind to its capture-shape hint", () => {
    expect(pullCaptureOpts("read_page")).toEqual({ pull: "page" });
    expect(pullCaptureOpts("get_dom")).toEqual({ pull: "dom" });
    expect(pullCaptureOpts("get_form")).toEqual({ pull: "form" });
    expect(pullCaptureOpts("read_tab")).toEqual({ pull: null });
  });
});

describe("extractPullRequests", () => {
  it("pulls valid requests in order, across all kinds", () => {
    const out = extractPullRequests([
      { type: "get_form" },
      { type: "read_tab", ref: "T2" },
      { type: "click", selector: "#x" },
      { type: "read_page" },
      { type: "get_dom" },
    ]);
    expect(out).toEqual([
      { type: "get_form" },
      { type: "read_tab", ref: "T2" },
      { type: "read_page" },
      { type: "get_dom" },
    ]);
    for (const r of out) expect(PullRequestSchema.safeParse(r).success).toBe(true);
  });

  it("ignores malformed read_tab entries (no/empty ref) — never fatal", () => {
    expect(extractPullRequests([{ type: "read_tab" }, { type: "read_tab", ref: "  " }])).toEqual([]);
    expect(extractPullRequests(null)).toEqual([]);
    expect(extractPullRequests("read_page")).toEqual([]);
  });

  it("sees actions that survive normalizeActions (the parse path)", async () => {
    const { normalizeActions } = await import("../extension/lib/modes.js");
    const actions = normalizeActions([{ type: "get_form" }, { read_tab: { ref: "T1" } }]);
    expect(extractPullRequests(actions)).toEqual([{ type: "get_form" }, { type: "read_tab", ref: "T1" }]);
  });
});

describe("pullHash (send-once keys)", () => {
  it("keeps the bare page hash for read_tab (existing tabsSent entries stay valid)", () => {
    expect(pullHash("read_tab", "h1")).toBe("h1");
  });

  it("prefixes the kind for active-page pulls — get_dom and get_form each send once per page", () => {
    expect(pullHash("get_dom", "h1")).toBe("get_dom:h1");
    expect(pullHash("get_form", "h1")).toBe("get_form:h1");
    expect(pullHash("read_page", "h1")).toBe("read_page:h1");
    expect(pullHash("get_dom", "h1")).not.toBe(pullHash("get_form", "h1"));
  });
});

describe("buildPullFollowUp — active-page kinds", () => {
  const target = { title: "Checkout", url: "https://shop.example.com/cart", host: "shop.example.com" };
  const capture = {
    url: target.url,
    title: target.title,
    tabId: 42,
    visibleText: "A".repeat(30000),
    clickable: Array.from({ length: DOM_CLICKABLE_CAP + 20 }, (_, i) => ({ text: `btn${i}`, tag: "button", selector: `#b${i}` })),
    formFields: Array.from({ length: DOM_FORM_CAP + 20 }, (_, i) => ({ tag: "input", type: "text", name: `f${i}`, selector: `#f${i}` })),
  };

  it("read_page renders a fenced text body clamped to the budget (default 12000)", () => {
    const fu = buildPullFollowUp("read_page", target, capture);
    expect(FollowUpSchema.safeParse(fu).success).toBe(true);
    expect(fu.kind).toBe("content");
    expect(fu.input).toContain("## Auto-fetched: page text on \"Checkout\" — shop.example.com");
    expect(fu.input).toContain("- URL: https://shop.example.com/cart");
    expect(fu.input).toContain("```text");
    expect(fu.input).toContain("A".repeat(12000));
    expect(fu.input).not.toContain("A".repeat(12001));
    expect(fu.input).toContain("Continue with the user's request");
  });

  it("read_page honors an explicit textBudget (mode budget)", () => {
    const fu = buildPullFollowUp("read_page", target, capture, { textBudget: 500 });
    expect(fu.input).toContain("A".repeat(500));
    expect(fu.input).not.toContain("A".repeat(501));
  });

  it("get_dom renders clickable + form sections via the compact serializers, render-capped", () => {
    const fu = buildPullFollowUp("get_dom", target, capture);
    expect(FollowUpSchema.safeParse(fu).success).toBe(true);
    expect(fu.kind).toBe("content");
    expect(fu.input).toContain(`Clickable (${DOM_CLICKABLE_CAP}):`);
    expect(fu.input).toContain(`Form fields (${DOM_FORM_CAP}):`);
    expect(fu.input).toContain(`[button "btn0" #b0]`);
    expect(fu.input).toContain(`[input#f0 type=text]`);
    // caps apply at render even when capture carried more
    expect(fu.input).not.toContain(`btn${DOM_CLICKABLE_CAP + 5}`);
  });

  it("get_form renders every field as the form schema", () => {
    const fu = buildPullFollowUp("get_form", target, capture);
    expect(fu.kind).toBe("content");
    expect(fu.input).toContain("## Auto-fetched: form fields on \"Checkout\" — shop.example.com");
    expect(fu.input).toContain(`- ${DOM_FORM_CAP} form fields`);
    expect(fu.input).toContain(`[input#f0 type=text]`);
  });

  it("empty pages degrade conversationally, still kind 'content'", () => {
    const dom = buildPullFollowUp("get_dom", target, { url: target.url, visibleText: "" });
    expect(dom.kind).toBe("content");
    expect(dom.input).toContain("no interactive elements found");
    const form = buildPullFollowUp("get_form", target, { url: target.url, visibleText: "" });
    expect(form.input).toContain("no form fields found");
  });

  it("reason branches mirror buildTabFollowUp kinds", () => {
    for (const reason of ["budget", "duplicate", "blank"] as const) {
      const fu = buildPullFollowUp("read_page", target, null, { reason });
      expect(fu.kind).toBe(reason);
      expect(FollowUpSchema.safeParse(fu).success).toBe(true);
    }
    const un = buildPullFollowUp("get_form", target, null);
    expect(un.kind).toBe("unavailable");
    expect(un.input).toContain("could not be captured");
  });

  it("read_tab delegates to buildTabFollowUp (tab semantics preserved)", () => {
    const fu = buildPullFollowUp("read_tab", { ref: "T1", title: "T", url: "https://t.example/", host: "t.example" }, { url: "https://t.example/", visibleText: "hello" });
    expect(fu.kind).toBe("content");
    expect(fu.input).toContain("## Auto-attached: tab [T1]");
  });

  it("accepts pageContext-shaped captures against the schema", () => {
    expect(PullCaptureSchema.safeParse(capture).success).toBe(true);
  });
});
