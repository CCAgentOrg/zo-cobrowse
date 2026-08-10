#!/usr/bin/env bun
/**
 * capture.ts — Live SSE capture from Zo /zo/ask for the test-prompts catalog.
 *
 * Usage:
 *   bun --env-file=.env tests/test-prompts/capture.ts
 *
 * Reads each entry in prompts.json, builds the exact prompt the extension would
 * send (importing real modes/intent logic), POSTs to /zo/ask with stream:true,
 * captures the raw SSE byte stream, and saves:
 *   fixtures/<id>.sse   — raw normalized SSE events
 *   fixtures/<id>.json  — metadata (request, response headers, event summary)
 *
 * Prints a discovery table at the end. Skips entries whose .sse already exists
 * unless --force is passed.
 *
 * Requirements: ZO_API_KEY (or ZO_ACCESS_TOKEN) exported, or loaded via
 * --env-file=.env (bun built-in). No chrome.* dependencies — runs in Node/bun.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Paths ────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMPTS_PATH = resolve(__dirname, "prompts.json");
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const SYNTHETIC_DIR = resolve(FIXTURES_DIR, "synthetic");

// Module roots for importing extension lib (relative to this script)
const EXT_LIB = resolve(__dirname, "..", "..", "extension", "lib");

// ── Config ────────────────────────────────────────────────────────────────
const ZO_API_URL = process.env.ZO_API_URL || "https://api.zo.computer/zo/ask";
const ZO_API_KEY = process.env.ZO_API_KEY || process.env.ZO_ACCESS_TOKEN || "";
const FORCE = process.argv.includes("--force");

// ── Load extension libs (pure ES modules, no chrome.* deps) ────────────────
let BUILTIN_MODES: Record<string, any>;
let ACTION_SCHEMA_COMPACT: string;
let PLAIN_RESPONSE_HINT: string;
let shouldDowngradeToJsonDisabled: (mode: any, query: string) => boolean;
let detectIntent: (query: string) => "action" | "read";

try {
  const modesMod = await import(resolve(EXT_LIB, "modes.js"));
  BUILTIN_MODES = modesMod.BUILTIN_MODES;
  ACTION_SCHEMA_COMPACT = modesMod.ACTION_SCHEMA_COMPACT;
  PLAIN_RESPONSE_HINT = modesMod.PLAIN_RESPONSE_HINT;
  const intentMod = await import(resolve(EXT_LIB, "intent.js"));
  shouldDowngradeToJsonDisabled = intentMod.shouldDowngradeToJsonDisabled;
  detectIntent = intentMod.detectIntent;
} catch (err) {
  console.error("❌ Failed to load extension libs:", (err as Error).message);
  process.exit(1);
}

// ── Prompt builder (mirrors extension/background.js buildPrompt) ───────────
function buildPrompt(
  mode: any,
  pageContext: { url: string; title: string; text?: string; elements?: string; forms?: string },
  userQuery: string,
): string {
  const lines: string[] = [];

  // system prompt
  if (mode.systemPrompt) lines.push(mode.systemPrompt);

  // page context
  if (pageContext.url) {
    lines.push("## Page");
    lines.push(`URL: ${pageContext.url}`);
    if (pageContext.title) lines.push(`Title: ${pageContext.title}`);
    lines.push("Viewport: 1920x1080");
  }
  if (pageContext.text && mode.contextTier >= 1) {
    lines.push("## Page Content");
    lines.push(pageContext.text.slice(0, mode.textBudget || 2000));
  }
  if (pageContext.elements && mode.contextTier >= 2) {
    lines.push("## Elements");
    lines.push(pageContext.elements);
  }
  if (pageContext.forms && mode.contextTier >= 2) {
    lines.push("## Forms");
    lines.push(pageContext.forms);
  }
  if (mode.contextTier >= 3) {
    // No real screenshot; note it's absent
    lines.push("## Screenshot");
    lines.push("(No screenshot available — capture context only for stream shape testing.)");
  }

  // instructions (if any)
  if (mode.instructions) lines.push(mode.instructions);

  // user query
  lines.push("## User Request");
  lines.push(userQuery);

  // action schema or plain markdown hint
  const wantJson = mode.expectJson && !shouldDowngradeToJsonDisabled(mode, userQuery);
  if (wantJson) {
    lines.push(ACTION_SCHEMA_COMPACT);
  } else {
    lines.push(PLAIN_RESPONSE_HINT);
  }

  return lines.join("\n\n");
}

// ── Synthetic page context (representative, not live) ──────────────────────
function makePageContext(tier: number) {
  const ctx: any = {
    url: "https://example.com/test-page",
    title: "Test Page for Zo Co-browse",
  };
  if (tier >= 1) {
    ctx.text = `Welcome to the Zo co-browsing test page. This page contains a navigation header with links to Pricing, Features, Docs, and About sections. The main content includes a hero section with a headline "Build Smarter with Zo" and a subheading describing the platform. There is a search box in the top right corner. Below the hero are three feature cards: Instant DuckDB Queries, Web Research Automation, and Custom Skill Builder. Each card has a "Learn More" link. The page footer contains copyright information and links to Privacy Policy and Terms of Service.`;
  }
  if (tier >= 2) {
    ctx.elements = `- link "Pricing" (#pricing)
- link "Features" (#features)
- link "Docs" (#docs)
- link "About" (#about)
- link "Learn More" (card-1 .cta)
- link "Learn More" (card-2 .cta)
- link "Learn More" (card-3 .cta)
- link "Privacy Policy" (footer .privacy)
- link "Terms of Service" (footer .terms)
- input "Search…" (#search-box)`;
    ctx.forms = `- form #search with fields: input[name="q"] (Search query)`;
  }
  return ctx;
}

// ── SSE stream capture ──────────────────────────────────────────────────────
interface CaptureResult {
  /** Scrubbed SSE (FrontendModelRequest echo + id: lines removed) */
  sseRaw: string;
  events: Array<{ event: string; data: string }>;
  xConversationId?: string;
  contentType?: string;
  status: number;
  /** Field keys of the first content-bearing data payload */
  firstChunkFields?: string[];
  /** Whether the `completed` terminal event was seen */
  completed: boolean;
  hasActions: boolean;
  hasReasoning: boolean;
  /** Text assembled from PartDeltaEvent text parts */
  assembledFullText: string;
  /** Reasoning assembled from PartDeltaEvent thinking parts */
  assembledReasoning: string;
  /** Tool calls seen (research mode) */
  toolCallCount: number;
  error?: string;
}

async function captureStream(
  entry: { id: string; mode: string; query: string; tier: number },
): Promise<CaptureResult> {
  const mode = BUILTIN_MODES[entry.mode];
  if (!mode) throw new Error(`Unknown mode: ${entry.mode}`);

  const pageCtx = makePageContext(entry.tier);
  const prompt = buildPrompt(mode, pageCtx, entry.query);

  console.log(`\n📡 ${entry.id} — POSTing to ${ZO_API_URL}`);

  const response = await fetch(ZO_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZO_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      input: prompt,
      stream: true,
      // Omit model_name to use the API default (matches extension behaviour when config.zoModel is "")
    }),
  });

  const xConversationId = response.headers.get("x-conversation-id") || undefined;
  const contentType = response.headers.get("content-type") || undefined;
  const status = response.status;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      sseRaw: `HTTP ${status}\n${body}`,
      events: [],
      status,
      contentType,
      completed: false,
      hasActions: false,
      hasReasoning: false,
      assembledFullText: "",
      assembledReasoning: "",
      toolCallCount: 0,
      error: `HTTP ${status} — ${body.slice(0, 200)}`,
    };
  }

  // Read the SSE body as raw text (non-streaming for a one-shot capture)
  const rawBody = await response.text();

  // ── Real Zo SSE protocol (discovered via live capture, 2026-08-09) ─────────
  //
  // Event types the API actually emits:
  //   AgentRuntimeStreamChunk   — lifecycle: {type:"status"|"persisted", status, data:{message_id}}
  //   FrontendModelRequest      — ECHO of the full request prompt (SCRUBBED — bloat + private content)
  //   PartStartEvent            — starts a part: {part:{part_kind:"thinking"|"text"|"tool-call"|...}}
  //   PartDeltaEvent            — incremental delta: {delta:{content_delta, part_delta_kind:"thinking"|"text"}}
  //   FunctionToolCallEvent     — tool invocation (research mode)
  //   FunctionToolResultEvent   — tool result
  //   completed                 — terminal: {status:"succeeded"|"failed", error}
  //
  // The extension's documented protocol (FrontendModelResponse/End/Error in
  // extension/AGENTS.md) was NEVER seen in any live capture — see qa-notes.md.

  const scrubbedLines: string[] = [];
  const events: Array<{ event: string; data: string }> = [];
  let currentEvent = "";
  let fullText = "";
  let reasoning = "";
  let firstFields: string[] | undefined;
  let completed = false;
  let hasActions = false;
  let hasReasoning = false;
  let toolCallCount = 0;
  // Track per-part accumulation so text vs thinking deltas route correctly
  const partKinds = new Map<number, string>(); // index → part_kind

  const lines = rawBody.split("\n");
  let skipUntilBlank = false; // for scrubbing FrontendModelRequest

  const PRIVATE_RE =
    /\/home\/workspace|zouroboros|memory\.ts|CashlessConsumer|Vaultwarden|Srikanth|AGENTS\.md|SOUL\.md/i;
  function redact(s: string): string {
    if (typeof s !== "string" || !PRIVATE_RE.test(s)) return s;
    return s.length > 60 ? s.slice(0, 60) + "...[REDACTED]" : "[REDACTED]";
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Scrub: skip SSE id: lines (per-event IDs — noise for fixtures)
    if (trimmed.startsWith("id:")) continue;

    // Scrub: skip the entire FrontendModelRequest event (request echo — contains
    // the full prompt including any private workspace context the API injects)
    if (trimmed === "event: FrontendModelRequest") {
      skipUntilBlank = true;
      currentEvent = "";
      continue;
    }
    if (skipUntilBlank) {
      if (trimmed === "") skipUntilBlank = false;
      continue;
    }

    // Track event: lines (don't push yet — push after data so we control the line)
    if (trimmed.startsWith("event:")) {
      currentEvent = trimmed.slice(6).trim();
      scrubbedLines.push(line);
      continue;
    }
    const dataMatch = trimmed.match(/^data:\s?(.*)$/);
    if (!dataMatch) {
      scrubbedLines.push(line);
      continue;
    }
    const data = dataMatch[1];

    let emitData = data;
    let parsed: any = null;
    try {
      parsed = JSON.parse(data);
      // First-chunk field discovery (any JSON payload)
      if (!firstFields) firstFields = Object.keys(parsed);

      // ── Privacy scrub: redact private fragments in tool calls / results / deltas ──
      let changed = false;
      const delta = parsed.delta || {};
      for (const key of ["content_delta", "args_delta", "tool_name_delta"]) {
        const val = delta[key];
        if (typeof val === "string" && PRIVATE_RE.test(val)) {
          delta[key] = redact(val);
          changed = true;
        }
      }
      const part = parsed.part || {};
      if (typeof part.args === "string" && PRIVATE_RE.test(part.args)) {
        // Fully redact tool-call args containing workspace paths
        part.args = '{"cmd":"[REDACTED — workspace path]"}';
        changed = true;
      }
      const result = parsed.result || {};
      const rc = result.content || {};
      if (typeof rc.stdout === "string" && PRIVATE_RE.test(rc.stdout)) {
        rc.stdout = rc.stdout.slice(0, 80) + "...[REDACTED — personal content]";
        changed = true;
      }
      if (changed) {
        emitData = JSON.stringify(parsed);
      }

      // ── Field tracking / accumulation ──
      if (currentEvent === "PartStartEvent") {
        const idx = parsed.index;
        const kind = parsed.part?.part_kind;
        if (typeof idx === "number" && kind) partKinds.set(idx, kind);
      } else if (currentEvent === "PartDeltaEvent") {
        const idx = parsed.index;
        const delta2 = parsed.delta || {};
        const piece = delta2.content_delta || "";
        const kind = delta2.part_delta_kind || partKinds.get(idx) || "";
        if (kind === "thinking") {
          reasoning += piece;
          if (piece) hasReasoning = true;
        } else if (kind === "text") {
          fullText += piece;
        }
      } else if (currentEvent === "FunctionToolCallEvent") {
        toolCallCount++;
      } else if (currentEvent === "completed") {
        completed = true;
      }
    } catch {
      // non-JSON data line — emit as-is
    }

    // Push the (possibly scrubbed) data line to the scrubbed output, and record
    // the original event in the events[] summary.
    scrubbedLines.push(`data: ${emitData}`);
    events.push({ event: currentEvent, data: emitData });
    currentEvent = "";
  }

  // Final shape analysis on assembled text
  const textTrim = fullText.trim();
  if (textTrim.includes('"actions"') || textTrim.includes('"click"') ||
      textTrim.includes('"fill"') || textTrim.includes('"navigate"')) {
    hasActions = true;
  }

  return {
    sseRaw: scrubbedLines.join("\n"),
    events,
    xConversationId,
    contentType,
    status,
    firstChunkFields: firstFields,
    completed,
    hasActions,
    hasReasoning,
    assembledFullText: fullText,
    assembledReasoning: reasoning,
    toolCallCount,
  };
}

// ── Save fixture files ──────────────────────────────────────────────────────
function saveFixture(
  entry: any,
  capture: CaptureResult,
  prompt: string,
  modelName?: string,
) {
  const ssePath = resolve(FIXTURES_DIR, `${entry.id}.sse`);
  const metaPath = resolve(FIXTURES_DIR, `${entry.id}.json`);

  // Write raw SSE (normalized)
  const sseContent = capture.sseRaw.endsWith("\n") ? capture.sseRaw : capture.sseRaw + "\n";
  writeFileSync(ssePath, sseContent, "utf-8");

  // Build metadata (prompt redacted for size + privacy — workspace AGENTS.md/SOUL.md
  // content gets injected by the API into FrontendModelRequest and must not be committed)
  const redactedPrompt =
    prompt.length > 200 ? prompt.slice(0, 200) + "...[REDACTED for size/privacy]" : prompt;
  const meta = {
    id: entry.id,
    request: {
      prompt: redactedPrompt,
      prompt_redacted: prompt.length > 200,
      model_name: modelName || "(default)",
      stream: true,
    },
    response: {
      x_conversation_id: capture.xConversationId,
      content_type: capture.contentType,
      status: capture.status,
    },
    summary: {
      eventCount: capture.events.length,
      eventTypes: [...new Set(capture.events.map((e) => e.event || "(default)"))],
      firstChunkFields: capture.firstChunkFields,
      completed: capture.completed,
      hasActions: capture.hasActions,
      hasReasoning: capture.hasReasoning,
      toolCallCount: capture.toolCallCount,
      assembledFullText: capture.assembledFullText.slice(0, 500),
      assembledReasoningLength: capture.assembledReasoning.length,
      error: capture.error || undefined,
    },
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  return { ssePath, metaPath };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!ZO_API_KEY) {
    console.error(
      "❌ ZO_API_KEY (or ZO_ACCESS_TOKEN) not set. " +
        "Run with: bun --env-file=.env tests/test-prompts/capture.ts",
    );
    process.exit(1);
  }

  // Ensure fixture directories exist
  mkdirSync(FIXTURES_DIR, { recursive: true });
  mkdirSync(SYNTHETIC_DIR, { recursive: true });

  // Load catalog
  const catalogRaw = readFileSync(PROMPTS_PATH, "utf-8");
  const catalog = JSON.parse(catalogRaw);
  console.log(`📋 Catalog: ${catalog.length} entries`);

  const results: Array<{ id: string; capture: CaptureResult; skipped: boolean }> = [];

  for (const entry of catalog) {
    const ssePath = resolve(FIXTURES_DIR, `${entry.id}.sse`);
    if (existsSync(ssePath) && !FORCE) {
      console.log(`⏭️  ${entry.id} — fixture already exists (--force to re-capture)`);
      results.push({ id: entry.id, capture: null as any, skipped: true });
      continue;
    }

    try {
      const cap = await captureStream(entry);
      const mode = BUILTIN_MODES[entry.mode];
      const pageCtx = makePageContext(entry.tier);
      const prompt = buildPrompt(mode, pageCtx, entry.query);

      saveFixture(entry, cap, prompt);
      results.push({ id: entry.id, capture: cap, skipped: false });
    } catch (err) {
      console.error(`❌ ${entry.id}:`, (err as Error).message);
      results.push({ id: entry.id, capture: null as any, skipped: false, error: (err as Error).message });
    }
  }

  // ── Discovery table ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(110));
  console.log(" DISCOVERY TABLE — Real SSE stream shapes from Zo /zo/ask");
  console.log("═".repeat(110));
  console.log(
    "ID".padEnd(28),
    "Evts".padEnd(6),
    "Completed".padEnd(10),
    "Actions".padEnd(8),
    "Reason".padEnd(7),
    "Tools".padEnd(6),
    "TextLen".padEnd(8),
  );
  console.log("─".repeat(110));

  for (const r of results) {
    const cap = r.capture;
    if (!cap) {
      const errMsg = (r as any).error ? ` error: ${(r as any).error}` : "";
      console.log(`${r.id.padEnd(28)} ⏭️${errMsg}`);
      continue;
    }
    console.log(
      r.id.padEnd(28),
      String(cap.events.length).padEnd(6),
      (cap.completed ? "✓" : "✗").padEnd(10),
      (cap.hasActions ? "yes" : "no").padEnd(8),
      (cap.hasReasoning ? "yes" : "no").padEnd(7),
      String(cap.toolCallCount).padEnd(6),
      String(cap.assembledFullText.length).padEnd(8),
    );
  }
  console.log("═".repeat(110));
  const captured = results.filter((r) => !r.skipped && r.capture).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n✅ ${captured} captured, ${skipped} skipped`);

  // Emit the protocol-discovery summary so any mismatch with extension/AGENTS.md is obvious
  const allEventTypes = new Set<string>();
  for (const r of results) {
    if (r.capture) {
      for (const e of r.capture.events) {
        if (e.event) allEventTypes.add(e.event);
      }
    }
  }
  console.log("\n📋 Event types seen across all captures:");
  console.log("   " + [...allEventTypes].sort().join(", "));
  console.log("   (extension/AGENTS.md documents: FrontendModelResponse, End, Error)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
