/**
 * stream-replay.test.ts — replays every captured .sse fixture through the real
 * extension stream parsers (extractStreamContent / finishStream) and documents
 * the current behavior as an executable baseline.
 *
 * TWO fixture classes:
 *
 * 1. `synthetic/*.sse` — hand-written fixtures matching the DOCUMENTED Zo protocol
 *    (FrontendModelResponse / End / Error). These assert the DESIRED contract
 *    and MUST pass — they are what the extension was built and tested against
 *    (mirrors tests/sse-parsing.test.ts).
 *
 * 2. `fixtures/*.sse` (excluding synthetic/) — REAL captured streams from the
 *    live Zo /zo/ask API. These document the ACTUAL protocol the API emits
 *    (PartDeltaEvent / PartStartEvent / completed — see qa-notes.md). They
 *    assert structural properties that hold today, and SURFACE the gaps where
 *    the extension's parser doesn't yet handle the real protocol. A failing
 *    assertion here is a known follow-up, not a regression.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { resolve, extname } from "path";
import { replaySse, parseFixtureEvents } from "./replay.js";
import {
  FixtureEventSequence,
  isRawActionJsonLeak,
  type ReplayResult,
} from "./schema.js";
import { normalizeActions } from "../../extension/lib/modes.js";

const FIXTURES_DIR = resolve(import.meta.dir, "fixtures");
const SYNTHETIC_DIR = resolve(FIXTURES_DIR, "synthetic");

function collectSseFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      files.push(...collectSseFiles(full));
    } else if (e.isFile() && extname(e.name) === ".sse") {
      files.push(full);
    }
  }
  return files;
}

const allFixtures = collectSseFiles(FIXTURES_DIR);
const liveFixtures = allFixtures.filter((p) => !p.startsWith(SYNTHETIC_DIR));
const syntheticFixtures = allFixtures.filter((p) => p.startsWith(SYNTHETIC_DIR));

const replayCache = new Map<string, ReplayResult>();
function replayFromFixture(fixturePath: string): ReplayResult {
  if (!replayCache.has(fixturePath)) {
    const raw = readFileSync(fixturePath, "utf-8");
    replayCache.set(fixturePath, replaySse(raw));
  }
  return replayCache.get(fixturePath)!;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — Synthetic fixtures (documented protocol): DESIRED contract MUST hold
// ═══════════════════════════════════════════════════════════════════════════

describe("synthetic fixtures — documented protocol (DESIRED contract)", () => {
  if (syntheticFixtures.length === 0) {
    it("has at least one synthetic fixture", () => {
      expect(syntheticFixtures.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const fixturePath of syntheticFixtures) {
    const name = fixturePath.replace(SYNTHETIC_DIR, "").replace(/^\/+/, "").replace(/\.sse$/, "");

    it(`${name}: event sequence is well-formed (FixtureEventSequence schema)`, () => {
      const raw = readFileSync(fixturePath, "utf-8");
      const events = parseFixtureEvents(raw).map((e) => ({ event: e.event || "", data: e.data }));
      expect(events.length).toBeGreaterThan(0);
      FixtureEventSequence.parse(events);
    });

    it(`${name}: terminal message is emitted (STREAM_DONE or STREAM_ERROR)`, () => {
      const result = replayFromFixture(fixturePath);
      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg).toBeDefined();
      expect(["STREAM_DONE", "STREAM_ERROR"]).toContain(lastMsg?.type);
    });

    it(`${name}: fullText does NOT contain raw JSON action-envelope leak`, () => {
      const result = replayFromFixture(fixturePath);
      const doneMsg = result.messages.find((m: any) => m.type === "STREAM_DONE") as any;
      if (!doneMsg) return;
      expect(isRawActionJsonLeak(doneMsg.fullText || "")).toBe(false);
    });

    it(`${name}: STREAM_CHUNK cumulative text never shrinks`, () => {
      const result = replayFromFixture(fixturePath);
      const chunks = result.messages.filter((m: any) => m.type === "STREAM_CHUNK") as any[];
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].text.length).toBeGreaterThanOrEqual(chunks[i - 1].text.length);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — Live fixtures (real API protocol): structural + protocol-discovery
// ═══════════════════════════════════════════════════════════════════════════

describe("live fixtures — real API protocol shape (structural assertions)", () => {
  if (liveFixtures.length === 0) {
    it("has live fixtures (run capture.ts to generate)", () => {
      expect(liveFixtures.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const fixturePath of liveFixtures) {
    const name = fixturePath.replace(FIXTURES_DIR, "").replace(/^\/+/, "").replace(/\.sse$/, "");

    it(`${name}: event sequence is well-formed (FixtureEventSequence schema)`, () => {
      const raw = readFileSync(fixturePath, "utf-8");
      const events = parseFixtureEvents(raw).map((e) => ({ event: e.event || "", data: e.data }));
      expect(events.length).toBeGreaterThan(0);
      FixtureEventSequence.parse(events);
    });

    it(`${name}: emits the real Zo protocol events (PartDeltaEvent + completed)`, () => {
      // The documented events (FrontendModelResponse/End/Error) are NEVER emitted
      // by the live API — see qa-notes.md. Every real stream uses PartDeltaEvent
      // for content and `completed` as the terminal signal.
      const raw = readFileSync(fixturePath, "utf-8");
      const eventTypes = new Set(
        parseFixtureEvents(raw).map((e) => e.event).filter(Boolean) as string[],
      );
      expect(eventTypes.has("PartDeltaEvent")).toBe(true);
      expect(eventTypes.has("completed")).toBe(true);
    });

    it(`${name}: never emits the documented-but-absent events`, () => {
      // Guards against the docs being silently correct without us noticing.
      // If this fails, the API changed and qa-notes.md should be updated.
      const raw = readFileSync(fixturePath, "utf-8");
      const eventTypes = new Set(
        parseFixtureEvents(raw).map((e) => e.event).filter(Boolean) as string[],
      );
      expect(eventTypes.has("FrontendModelResponse")).toBe(false);
      expect(eventTypes.has("End")).toBe(false);
    });

    it(`${name}: contains no private workspace content (scrub verification)`, () => {
      const raw = readFileSync(fixturePath, "utf-8");
      // The capture script scrubs FrontendModelRequest (request echo) and
      // private fragments. This guards a leak ever being committed.
      expect(raw).not.toMatch(/\/home\/workspace/);
      expect(raw).not.toMatch(/FrontendModelRequest/);
    });

    it(`${name}: fixture file is non-trivial (has content deltas)`, () => {
      const raw = readFileSync(fixturePath, "utf-8");
      const stat = statSync(fixturePath);
      expect(stat.size).toBeGreaterThan(500); // not empty / not a stub
      const deltaCount = (raw.match(/part_delta_kind/g) || []).length;
      expect(deltaCount).toBeGreaterThan(2);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — Live fixtures: current extension behavior baseline (DOCUMENTS gaps)
//
// These assertions describe what the extension's parser ACTUALLY does with the
// real stream today. They are intentionally permissive: a live stream falls
// through the byte-loop's branches (no End/[DONE]/FrontendModelResponse) to the
// stream-close fallback, which calls finishStream with whatever fullText
// extractStreamContent managed to pull from delta.content_delta. Because the
// parser doesn't route on part_delta_kind, thinking + text get concatenated.
//
// When the extension is fixed to handle the real protocol, update these
// assertions to the stricter DESIRED contract (and move them into Part 1).
// ═══════════════════════════════════════════════════════════════════════════

describe("live fixtures — extension behavior baseline (documents current gaps)", () => {
  if (liveFixtures.length === 0) {
    it("skip — no live fixtures", () => {});
    return;
  }

  for (const fixturePath of liveFixtures) {
    const name = fixturePath.replace(FIXTURES_DIR, "").replace(/^\/+/, "").replace(/\.sse$/, "");

    it(`${name}: replay produces at least one STREAM_* message`, () => {
      const result = replayFromFixture(fixturePath);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it(`${name}: replay terminates (stream-close fallback calls finishStream)`, () => {
      // Today the real stream has no End event, so the byte-loop hits the
      // stream-close fallback (background.js:981) → finishStream(fullText).
      const result = replayFromFixture(fixturePath);
      const types = result.messages.map((m) => m.type);
      expect(types).toContain("STREAM_DONE");
    });

    it(`${name}: produces STREAM_CHUNK messages from PartDeltaEvent deltas`, () => {
      // extractStreamContent recognizes delta.content_delta (background.js:93),
      // so content IS extracted — but without part_delta_kind routing.
      const result = replayFromFixture(fixturePath);
      const chunks = result.messages.filter((m: any) => m.type === "STREAM_CHUNK");
      expect(chunks.length).toBeGreaterThan(0);
    });

    it(`${name}: reasoning IS separated from answer text`, () => {
      // FIXED: replay routes on part_delta_kind, so thinking deltas stream as
      // STREAM_REASONING and text deltas stream as STREAM_CHUNK. The final
      // STREAM_DONE carries reasoning and fullText as separate, non-overlapping
      // channels. See qa-notes.md §"Implications" for the original gap.
      const raw = readFileSync(fixturePath, "utf-8");
      const events = parseFixtureEvents(raw);
      const hasThinking = events.some(
        (e) => e.parsed?.delta?.part_delta_kind === "thinking",
      );
      const hasText = events.some(
        (e) => e.parsed?.delta?.part_delta_kind === "text",
      );
      // Every live capture has both thinking and text channels.
      expect(hasThinking).toBe(true);
      expect(hasText).toBe(true);

      const result = replayFromFixture(fixturePath);
      // Must emit STREAM_REASONING messages.
      const reasoningMsgs = result.messages.filter((m: any) => m.type === "STREAM_REASONING");
      expect(reasoningMsgs.length).toBeGreaterThan(0);
      // STREAM_DONE reasoning is non-empty (final accumulated thinking).
      const doneMsg = result.messages.find((m: any) => m.type === "STREAM_DONE") as any;
      expect(doneMsg?.reasoning).toBeTruthy();
      expect(doneMsg.reasoning.length).toBeGreaterThan(0);
      // fullText contains ONLY the text channel, not thinking.
      expect(doneMsg?.fullText).toBeTruthy();
      expect(doneMsg.fullText.length).toBeGreaterThan(0);
      // Cross-check: fullText does NOT start with the first reasoning token.
      // (This validates separation: the first PartDeltaEvent is always thinking.)
      const firstThinking = events.find((e) => e.parsed?.delta?.part_delta_kind === "thinking");
      const firstThinkingToken = firstThinking?.parsed?.delta?.content_delta;
      if (firstThinkingToken && typeof doneMsg.fullText === "string") {
        expect(doneMsg.fullText.startsWith(firstThinkingToken)).toBe(false);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 4 — Cobrowse action fixtures: envelope shape assertions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reconstruct the text channel from a fixture: PartStartEvent's part.content
 * (first piece) + all PartDeltaEvent deltas with part_delta_kind:"text".
 * Reasoning (part_delta_kind:"thinking") is excluded.
 */
function reconstructTextChannel(raw: string): string {
  const events = parseFixtureEvents(raw);
  let text = "";
  for (const e of events) {
    const p = e.parsed;
    if (!p) continue;
    // PartStartEvent carries the first piece in part.content
    if (e.event === "PartStartEvent" && p.part?.part_kind === "text") {
      text += p.part.content || "";
    }
    // PartDeltaEvent carries subsequent pieces in delta.content_delta
    if (e.event === "PartDeltaEvent" && p.delta?.part_delta_kind === "text") {
      text += p.delta.content_delta || "";
    }
  }
  return text;
}

/** Extract the first JSON object from a text string (handles code fences). */
function extractFirstJson(text: string): any | null {
  // Try fenced ```json ... ``` first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find the first {...} block
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  try {
    return JSON.parse(objMatch[0]);
  } catch {
    return null;
  }
}

describe("cobrowse action fixtures — action envelope shape", () => {
  const actionFixtures = liveFixtures.filter((p) =>
    p.includes("cobrowse-action") && !p.includes("readonly"),
  );

  for (const fixturePath of actionFixtures) {
    const name = fixturePath.replace(FIXTURES_DIR, "").replace(/^\/+/, "").replace(/\.sse$/, "");

    it(`${name}: text channel contains an "actions" envelope`, () => {
      // The model emits a JSON action envelope in the text channel. It may be
      // wrapped in a ```json fence OR bare, and the key naming is non-deterministic
      // ("actions" always present).
      const textContent = reconstructTextChannel(readFileSync(fixturePath, "utf-8"));
      expect(textContent).toMatch(/"actions"/);
    });

    it(`${name}: action objects carry a recognizable action type`, () => {
      // The model is non-deterministic about action shape: sometimes key-first
      // ({"click":{...}}), sometimes type-first ({"type":"click",...}), sometimes
      // a non-spec variant ({"action":"fill",...}). All three appear in captures.
      // normalizeActions handles key-first + type-first; the "action" variant is
      // a documented gap.
      const textContent = reconstructTextChannel(readFileSync(fixturePath, "utf-8"));
      const envelope = extractFirstJson(textContent);
      expect(envelope).not.toBeNull();
      expect(Array.isArray(envelope.actions)).toBe(true);
      expect(envelope.actions.length).toBeGreaterThan(0);
      // At least one action references a known action type somewhere
      const flat = JSON.stringify(envelope.actions);
      const knownTypes = ["click", "fill", "extract", "navigate", "scroll", "wait", "done", "action"];
      expect(knownTypes.some((t) => flat.includes(`"${t}"`))).toBe(true);
    });
  }

  // Cobrowse-readonly should NOT have an action envelope
  const readonlyFixture = liveFixtures.find((p) => p.includes("cobrowse-readonly"));
  if (readonlyFixture) {
    it("cobrowse-readonly: text channel is plain markdown (no action envelope)", () => {
      // Intent downgrade worked: cobrowse mode + read-only query → plain markdown,
      // not the JSON action envelope. This confirms shouldDowngradeToJsonDisabled
      // causes the PLAIN_RESPONSE_HINT to be sent instead of ACTION_SCHEMA_COMPACT.
      const textContent = reconstructTextChannel(readFileSync(readonlyFixture, "utf-8"));
      expect(textContent).not.toMatch(/"actions"\s*:/);
      expect(textContent.length).toBeGreaterThan(0);
    });
  }
});
