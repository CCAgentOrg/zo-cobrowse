import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  buildPrompt,
  describePrompt,
  estimateTokens,
  compactEl,
  compactForm,
  safeText,
  SECTION_LABELS,
} from "../extension/lib/prompt.js";
import { BUILTIN_MODES, TIER, ACTION_SCHEMA_COMPACT, PLAIN_RESPONSE_HINT } from "../extension/lib/modes.js";
import { DescribedPromptSchema } from "./schemas/prompt.js";

const promptLibCode = readFileSync(
  resolve(import.meta.dir, "../extension/lib/prompt.js"),
  "utf-8",
);

// ---- fixtures ----------------------------------------------------------------

function makeCtx(opts: Partial<{
  url: string; title: string; visibleText: string; clickable: unknown[]; formFields: unknown[]; viewport: { w: number; h: number }; screenshotDataUrl: string;
}> = {}) {
  return {
    url: opts.url ?? "https://example.com",
    title: opts.title ?? "Example",
    visibleText: opts.visibleText ?? "Hello world",
    clickable: opts.clickable ?? [],
    formFields: opts.formFields ?? [],
    viewport: opts.viewport ?? { w: 800, h: 600 },
    ...(opts.screenshotDataUrl ? { screenshotDataUrl: opts.screenshotDataUrl } : {}),
  };
}

function expectValid(described: unknown) {
  const parsed = DescribedPromptSchema.safeParse(described);
  if (!parsed.success) {
    throw new Error(
      `describePrompt failed schema validation:\n${JSON.stringify(described, null, 2)}\n${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ---- byte-exact parity with the historical background.js buildPrompt ---------

describe("buildPrompt — parity with the original assembler", () => {
  it("reproduces the exact ask-mode prompt string (join, spacing, section order)", () => {
    const mode = BUILTIN_MODES.ask; // tier 1, expectJson false
    const ctx = makeCtx({ visibleText: "Hello world" });
    const expected = [
      mode.systemPrompt,
      "",
      "## Page",
      "- URL: https://example.com",
      "- Title: Example",
      "- Viewport: 800x600",
      "",
      "## Page Content",
      "```",
      "Hello world",
      "```",
      "",
      "## User Request",
      "What is this?",
      "",
      mode.instructions,
      PLAIN_RESPONSE_HINT,
    ].join("\n");
    expect(buildPrompt(mode, ctx, "What is this?")).toBe(expected);
  });

  it("starts with the Mode systemPrompt and ends with the instruction tail", () => {
    const p = buildPrompt(BUILTIN_MODES.research, makeCtx(), "Analyze");
    expect(p.startsWith(BUILTIN_MODES.research.systemPrompt)).toBe(true);
    expect(p.endsWith(PLAIN_RESPONSE_HINT)).toBe(true);
  });
});

// ---- tier gating -------------------------------------------------------------

describe("buildPrompt — tier gating", () => {
  it("tier 0 emits URL/title/viewport only (no content/elements)", () => {
    const p = buildPrompt(BUILTIN_MODES.cobrowse, makeCtx(), "go", { effectiveTier: TIER.POINTER });
    expect(p).toContain("## Page");
    expect(p).not.toContain("## Page Content");
    expect(p).not.toContain("## Elements");
    expect(p).not.toContain("## Forms");
  });

  it("tier 1 adds Page Content but not elements/forms", () => {
    const p = buildPrompt(BUILTIN_MODES.cobrowse, makeCtx(), "go", { effectiveTier: TIER.TEXT });
    expect(p).toContain("## Page Content");
    expect(p).not.toContain("## Elements");
    expect(p).not.toContain("## Forms");
  });

  it("tier 2 adds Elements + Forms when present", () => {
    const ctx = makeCtx({
      clickable: [{ text: "Pricing", tag: "a", selector: "#pricing" }],
      formFields: [{ tag: "input", type: "text", selector: "#q", placeholder: "Search" }],
    });
    const p = buildPrompt(BUILTIN_MODES.cobrowse, ctx, "go", { effectiveTier: TIER.ELEMENTS });
    expect(p).toContain("## Elements");
    expect(p).toContain("## Forms");
  });

  it("without opts, uses mode.contextTier (cobrowse → elements)", () => {
    // cobrowse.contextTier === 2; with elements present they appear.
    const ctx = makeCtx({ clickable: [{ text: "Go", tag: "a", selector: "#go" }] });
    const p = buildPrompt(BUILTIN_MODES.cobrowse, ctx, "click go");
    expect(p).toContain("## Elements");
  });

  it("effectiveTier overrides mode.contextTier downward (read follow-up thinning)", () => {
    // cobrowse (tier 2) thinned to tier 0 for a follow-up turn.
    const ctx = makeCtx({ clickable: [{ text: "Go", tag: "a", selector: "#go" }] });
    const p = buildPrompt(BUILTIN_MODES.cobrowse, ctx, "click go", { effectiveTier: 0 });
    expect(p).not.toContain("## Elements");
    expect(p).not.toContain("## Page Content");
  });

  it("caps visibleText at mode.textBudget", () => {
    const long = "x".repeat(3000);
    const p = buildPrompt(BUILTIN_MODES.ask, makeCtx({ visibleText: long }), "q");
    // ask.textBudget === 2000 → the fenced content is exactly 2000 chars.
    const fenced = p.split("## Page Content\n```\n")[1].split("\n```")[0];
    expect(fenced.length).toBe(2000);
  });

  it("tier 3 screenshot only when screenshotDataUrl is present", () => {
    const withShot = buildPrompt(BUILTIN_MODES.visual, makeCtx({ screenshotDataUrl: "data:image/jpeg;base64,AAA" }), "describe");
    expect(withShot).toContain("## Screenshot");
    const noShot = buildPrompt(BUILTIN_MODES.visual, makeCtx(), "describe");
    expect(noShot).not.toContain("## Screenshot");
  });
});

// ---- intent downgrade (moved from background.test.ts — logic now in prompt.js)

describe("buildPrompt — intent-aware JSON/markdown downgrade", () => {
  it("prompt.js imports the downgrade classifier from intent.js", () => {
    expect(promptLibCode).toMatch(/import\s*\{[^}]*shouldDowngradeToJsonDisabled[^}]*\}\s*from\s*['"]\.\/intent\.js['"]/);
  });

  it("cobrowse action query → appends ACTION_SCHEMA_COMPACT", () => {
    const p = buildPrompt(BUILTIN_MODES.cobrowse, makeCtx(), "Click the login button");
    expect(p).toContain(ACTION_SCHEMA_COMPACT);
  });

  it("cobrowse read query → downgrades to plain markdown (no action envelope)", () => {
    // "Summarize this page" is a read-only leader → downgrade fires even in
    // the action mode, so the answer renders as prose, not {actions:[...]}.
    const p = buildPrompt(BUILTIN_MODES.cobrowse, makeCtx(), "Summarize this page");
    expect(p).not.toContain(ACTION_SCHEMA_COMPACT);
    expect(p).toContain(PLAIN_RESPONSE_HINT);
    expect(p).toContain("Answer the request directly using the page content provided.");
  });
});

// ---- describePrompt (structured view for the inspector / Settings editor) ----

describe("describePrompt — structured breakdown", () => {
  it("returns a schema-valid structure", () => {
    const described = describePrompt(BUILTIN_MODES.cobrowse, makeCtx({
      clickable: [{ text: "A", tag: "a", selector: "#a" }],
      formFields: [{ tag: "input", type: "text", selector: "#q", placeholder: "Search" }],
    }), "click a");
    expectValid(described);
  });

  it("prompt field equals buildPrompt output", () => {
    const mode = BUILTIN_MODES.ask;
    const ctx = makeCtx();
    expect(describePrompt(mode, ctx, "hi").prompt).toBe(buildPrompt(mode, ctx, "hi"));
  });

  it("system + tail are editable; page/content/elements/forms/screenshot/userRequest are not", () => {
    const described = describePrompt(BUILTIN_MODES.cobrowse, makeCtx({
      clickable: [{ text: "A", tag: "a", selector: "#a" }],
    }), "click a");
    const byId = Object.fromEntries(described.sections.map((s) => [s.id, s]));
    expect(byId.system.editable).toBe(true);
    expect(byId.tail.editable).toBe(true);
    expect(byId.page.editable).toBe(false);
    expect(byId.userRequest.editable).toBe(false);
  });

  it("reports intent + expectJson metadata (action turn)", () => {
    const described = describePrompt(BUILTIN_MODES.cobrowse, makeCtx(), "Click login");
    expect(described.intent).toBe("action");
    expect(described.expectJson).toBe(true);
    expect(described.downgradeApplied).toBe(false);
  });

  it("reports downgradeApplied for a read query in an action mode", () => {
    const described = describePrompt(BUILTIN_MODES.cobrowse, makeCtx(), "Summarize this page");
    expect(described.downgradeApplied).toBe(true);
    expect(described.expectJson).toBe(false);
  });

  it("tier field reflects the resolved effective tier", () => {
    expect(describePrompt(BUILTIN_MODES.cobrowse, makeCtx(), "q", { effectiveTier: 0 }).tier).toBe(0);
    expect(describePrompt(BUILTIN_MODES.cobrowse, makeCtx(), "q").tier).toBe(BUILTIN_MODES.cobrowse.contextTier);
  });

  it("approxTokens is a positive ~chars/4 estimate", () => {
    const described = describePrompt(BUILTIN_MODES.ask, makeCtx(), "q");
    expect(described.approxTokens).toBeGreaterThan(0);
    expect(described.approxTokens).toBe(Math.ceil(described.prompt.length / 4));
  });
});

// ---- helpers -----------------------------------------------------------------

describe("prompt helpers", () => {
  it("estimateTokens is ceil(length / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("compactEl truncates text to 40 chars and formats [tag \"text\" selector]", () => {
    const out = compactEl({ tag: "a", text: "Hello World That Is Quite Long Indeed", selector: "#nav" });
    expect(out).toBe('[a "Hello World That Is Quite Long Indeed" #nav]');
    const truncated = compactEl({ tag: "button", text: "x".repeat(60), selector: ".c" });
    expect([...truncated.matchAll(/"([^"]*)"/g)][0][1].length).toBe(40);
  });

  it("compactForm formats [tag selector type=t \"placeholder\"]", () => {
    expect(compactForm({ tag: "input", type: "text", selector: "#q", placeholder: "Search" }))
      .toBe('[input#q type=text "Search"]');
  });

  it("safeText passes strings, blanks nullish, JSON-stringifies objects", () => {
    expect(safeText("hi")).toBe("hi");
    expect(safeText(null)).toBe("");
    expect(safeText(undefined)).toBe("");
    expect(safeText({ a: 1 })).toBe('{"a":1}');
    // Circular values throw during JSON.stringify → safeText returns ''.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeText(circular)).toBe("");
  });

  it("SECTION_LABELS covers every section id describePrompt can emit", () => {
    const ids = new Set(["system", "page", "content", "elements", "forms", "screenshot", "userRequest", "tail"]);
    for (const id of ids) expect(SECTION_LABELS[id]).toBeTruthy();
  });

  it("does not throw on an empty pageContext", () => {
    expect(() => buildPrompt(BUILTIN_MODES.ask, {}, "q")).not.toThrow();
    const p = buildPrompt(BUILTIN_MODES.ask, {}, "q");
    expect(p).toContain("- Viewport: ?x?");
    expect(p).toContain("## Page Content"); // tier 1 → '—empty—' placeholder
  });
});
