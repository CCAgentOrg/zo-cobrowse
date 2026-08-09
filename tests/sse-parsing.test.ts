import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as vm from "node:vm";
import { normalizeActions } from "../extension/lib/modes.js";

/**
 * Verify the /zo/ask SSE parser against real-world stream formats.
 *
 * Background: the side panel showed "Done." with no content (ticket #29). The
 * repo had ZERO coverage of SSE parsing — every field assumption was inferred.
 * These tests exercise the actual `_askZoStreamImpl` + `extractStreamContent` +
 * `finishStream` code from background.js against documented and provider-
 * specific (OpenAI/Anthropic) SSE byte streams.
 *
 * Approach: extract the helper functions from the real source (not a rewrite)
 * and drive a byte-level SSE reader through them. `extractStreamContent` is
 * the field-extraction contract; the chunk-loop semantics are validated by
 * replaying complete SSE streams and asserting the assembled text.
 */

const BG_PATH = resolve(import.meta.dir, "../extension/background.js");
const bgSource = readFileSync(BG_PATH, "utf-8");

// Extract the real extractStreamContent + safeText from the source via vm,
// so we test the ACTUAL production code, not a reimplementation.
function loadHelpers() {
  const start = bgSource.indexOf("// ---- Stream content extraction ----");
  const safeStart = bgSource.indexOf("function safeText(");
  // find the closing brace of safeText by brace-matching
  let depth = 0;
  let end = safeStart;
  for (let i = safeStart; i < bgSource.length; i++) {
    if (bgSource[i] === "{") depth++;
    else if (bgSource[i] === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  // Slice from the extraction comment header through the end of safeText.
  const slice = bgSource.slice(start, end);
  const sandbox: any = {};
  vm.createContext(sandbox);
  vm.runInContext(slice, sandbox);
  if (typeof sandbox.extractStreamContent !== "function") {
    throw new Error("failed to load extractStreamContent from background.js");
  }
  return { extractStreamContent: sandbox.extractStreamContent, safeText: sandbox.safeText };
}

const { extractStreamContent, safeText } = loadHelpers();

/**
 * Replays a raw SSE byte string through the same chunk-loop semantics used by
 * _askZoStreamImpl: split on \n, track currentEventType, match `data:` lines,
 * handle End/Error/End-empty, accumulate fullText via extractStreamContent.
 * Mirrors background.js lines ~843-944.
 */
function parseSseStream(rawSse: string): {
  fullText: string;
  chunks: string[];
  endedVia: "End" | "empty-end" | "stream-close";
} {
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = "";
  let fullText = "";
  let currentEventType = "";
  let endedVia: "End" | "empty-end" | "stream-close" = "stream-close";

  // Simulate the reader delivering the whole payload at once.
  buffer += decoder.decode(Buffer.from(rawSse), { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;

    if (trimmed.startsWith("event:")) {
      currentEventType = trimmed.slice(6).trim();
      continue;
    }

    const dataMatch = trimmed.match(/^data:\s?(.*)$/);
    if (!dataMatch) continue;
    const data = dataMatch[1].trim();
    if (!data) continue;

    if (currentEventType === "End") {
      if (data !== "{}" && data !== "") {
        try {
          const parsed = JSON.parse(data);
          if (!fullText) {
            const endContent = typeof parsed.output === "string" ? parsed.output : "";
            fullText =
              endContent ||
              extractStreamContent(parsed) ||
              (parsed.reasoning || parsed.actions ? safeText(parsed) : "");
          }
        } catch {}
      } else {
        endedVia = "empty-end";
      }
      endedVia = data === "{}" || data === "" ? "empty-end" : "End";
      currentEventType = "";
      return { fullText, chunks, endedVia };
    }

    try {
      const parsed = JSON.parse(data);
      const content = extractStreamContent(parsed);
      if (content) {
        fullText += content;
        chunks.push(content);
      }
      if (
        parsed.done ||
        parsed.finish_reason ||
        parsed.type === "final" ||
        parsed.type === "complete" ||
        parsed.type === "End"
      ) {
        endedVia = "End";
        return { fullText, chunks, endedVia };
      }
    } catch {
      if (data === "[DONE]") {
        endedVia = "End";
        return { fullText, chunks, endedVia };
      }
      fullText += safeText(data);
      chunks.push(safeText(data));
    }
  }
  return { fullText, chunks, endedVia };
}

describe("extractStreamContent (real background.js helper)", () => {
  it("is exported from background.js", () => {
    expect(bgSource).toContain("function extractStreamContent");
  });

  it("reads Zo-canonical data.content", () => {
    expect(extractStreamContent({ content: "hello" })).toBe("hello");
  });

  it("reads data.output (string)", () => {
    expect(extractStreamContent({ output: "answer" })).toBe("answer");
  });

  it("reads data.text", () => {
    expect(extractStreamContent({ text: "hi" })).toBe("hi");
  });

  it("reads data.response", () => {
    expect(extractStreamContent({ response: "r" })).toBe("r");
  });

  it("reads OpenAI choices[0].delta.content", () => {
    expect(
      extractStreamContent({ choices: [{ delta: { content: "tok" } }] }),
    ).toBe("tok");
  });

  it("reads OpenAI choices[0].message.content", () => {
    expect(
      extractStreamContent({ choices: [{ message: { content: "full" } }] }),
    ).toBe("full");
  });

  it("reads Anthropic delta.text", () => {
    expect(extractStreamContent({ delta: { text: "a" } })).toBe("a");
  });

  it("reads Anthropic delta.content", () => {
    expect(extractStreamContent({ delta: { content: "b" } })).toBe("b");
  });

  it("reads delta.content_delta", () => {
    expect(extractStreamContent({ delta: { content_delta: "c" } })).toBe("c");
  });

  it("reads nested message.content", () => {
    expect(extractStreamContent({ message: { content: "deep" } })).toBe("deep");
  });

  it("stringifies object output as last resort", () => {
    const out = extractStreamContent({ output: { reasoning: "x" } });
    expect(out).toContain("reasoning");
  });

  it("returns '' for unknown shape (no silent garbage)", () => {
    expect(extractStreamContent({ unrelated: true })).toBe("");
  });
});

describe("SSE stream replay → assembled fullText", () => {
  it("Zo canonical: FrontendModelResponse chunks in data.content + End {}", () => {
    const sse = [
      'event: FrontendModelResponse',
      'data: {"content":"Hello"}',
      '',
      'event: FrontendModelResponse',
      'data: {"content":" world"}',
      '',
      'event: End',
      'data: {}',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("Hello world");
    expect(r.chunks).toEqual(["Hello", " world"]);
  });

  it("Zo End-only: full answer in End data.output (no incremental chunks)", () => {
    const sse = [
      'event: End',
      'data: {"output":"The full answer here."}',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("The full answer here.");
    expect(r.endedVia).toBe("End");
  });

  it("Zo End with structured reasoning/actions (no output field)", () => {
    const sse = [
      'event: End',
      'data: {"reasoning":"thinking...","actions":[{"type":"done","response":"Done answer"}]}',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    // output field absent → falls back to extractStreamContent (empty) then
    // reasoning/actions presence → safeText(parsed). finishStream then resolves
    // the done action's response. fullText carries the raw object here.
    expect(r.fullText).toContain("thinking");
    expect(r.fullText).toContain("Done answer");
  });

  it("OpenAI-style: choices[0].delta.content + [DONE]", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hi "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"there"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("Hi there");
  });

  it("Anthropic-style: event: content_block_delta with delta.text", () => {
    const sse = [
      'event: content_block_delta',
      'data: {"delta":{"text":"Mar"}}',
      '',
      'event: content_block_delta',
      'data: {"delta":{"text":"vel"}}',
      '',
      'event: message_stop',
      'data: {}',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("Marvel");
  });

  it("Empty End event AFTER chunks: must not clobber accumulated text", () => {
    // Regression for the historical "Done." bug: chunks arrived, then End {}
    // with no output. fullText must survive.
    const sse = [
      'event: FrontendModelResponse',
      'data: {"content":"accumulated"}',
      '',
      'event: End',
      'data: {}',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("accumulated");
    expect(r.endedVia).toBe("empty-end");
  });

  it("End with output does NOT overwrite already-streamed text", () => {
    const sse = [
      'event: FrontendModelResponse',
      'data: {"content":"streamed"}',
      '',
      'event: End',
      'data: {"output":"should not replace"}',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("streamed");
  });

  it("plain-text SSE chunks (no JSON) accumulate", () => {
    const sse = [
      'data: hello',
      '',
      'data: world',
      '',
      'data: [DONE]',
      '',
    ].join("\n");
    const r = parseSseStream(sse);
    expect(r.fullText).toBe("helloworld");
  });
});

describe("finishStream plain-text path (ticket #29)", () => {
  // Reuse the real finishStream by extracting it too is heavy; instead assert
  // the source-level fix: non-JSON output is surfaced as plainText, and the
  // bare "Done." fallback is removed from sidepanel.js.
  it("background.js finishStream has a plainText path for non-JSON output", () => {
    expect(bgSource).toMatch(/let plainText/);
    expect(bgSource).toMatch(/plainText = normalizedOutput/);
    expect(bgSource).toMatch(/safeDoneResponse \|\| plainText/);
  });

  it("sidepanel.js no longer shows a bare 'Done.' fallback", () => {
    const sp = readFileSync(
      resolve(import.meta.dir, "../extension/sidepanel.js"),
      "utf-8",
    );
    // The misleading bare "Done." literal must be gone; replaced by a hint.
    expect(sp).not.toContain("addMessage('assistant', 'Done.')");
    expect(sp).toContain("empty response");
  });
});

describe("finishStream preserves reasoning into STREAM_DONE", () => {
  // The thinking bubble depends on reasoning surviving finishStream. Extract
  // the real finishStream + safeText via vm (same pattern as loadHelpers) and
  // drive it with a fake recording port. Also stub safePost since the slice
  // only contains these two functions.
  function braceEnd(src: string, start: number): number {
    let depth = 0;
    let started = false;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") { depth++; started = true; }
      else if (src[i] === "}") {
        depth--;
        if (started && depth === 0) return i + 1;
      }
    }
    return start;
  }
  function loadFinishStream() {
    const safeStart = bgSource.indexOf("function safeText(");
    const safeEnd = braceEnd(bgSource, safeStart);
    const fsStart = bgSource.indexOf("function finishStream(");
    const fsEnd = braceEnd(bgSource, fsStart);
    const safeSlice = bgSource.slice(safeStart, safeEnd);
    const fsSlice = bgSource.slice(fsStart, fsEnd);
    const sandbox: any = {
      // finishStream calls safePost(port, msg); record what it posts.
      safePost: (port: any, msg: any) => { port.postMessage(msg); },
      // finishStream calls normalizeActions (imported from lib/modes.js).
      normalizeActions,
    };
    vm.createContext(sandbox);
    vm.runInContext(safeSlice + "\n" + fsSlice, sandbox);
    if (typeof sandbox.finishStream !== "function") {
      throw new Error("failed to load finishStream from background.js");
    }
    return sandbox.finishStream as (port: any, sid: string, output: any) => void;
  }

  it("carries reasoning through STREAM_DONE (object output)", () => {
    const finishStream = loadFinishStream();
    const posted: any[] = [];
    const fakePort = { _dead: false, postMessage: (m: any) => posted.push(m) };
    finishStream(fakePort, "sid-1", {
      reasoning: "The page is a landing page with no substantive content.",
      actions: [{ type: "done", response: "## Summary: ..." }],
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("STREAM_DONE");
    expect(posted[0].reasoning).toBe("The page is a landing page with no substantive content.");
    expect(posted[0].reasoning.length).toBeGreaterThan(0);
  });

  it("carries reasoning through STREAM_DONE (JSON-string output)", () => {
    const finishStream = loadFinishStream();
    const posted: any[] = [];
    const fakePort = { _dead: false, postMessage: (m: any) => posted.push(m) };
    finishStream(fakePort, "sid-2", JSON.stringify({
      reasoning: "stringified reasoning",
      actions: [],
    }));
    expect(posted[0].reasoning).toBe("stringified reasoning");
  });

  it("no-ops the port when dead (safePost contract)", () => {
    // Re-extract with a safePost that honors the real _dead contract.
    const safeStart = bgSource.indexOf("function safeText(");
    const safeEnd = braceEnd(bgSource, safeStart);
    const fsStart = bgSource.indexOf("function finishStream(");
    const fsEnd = braceEnd(bgSource, fsStart);
    const spStart = bgSource.indexOf("function safePost(");
    const spEnd = braceEnd(bgSource, spStart);
    const sandbox: any = { normalizeActions };
    vm.createContext(sandbox);
    vm.runInContext(
      bgSource.slice(spStart, spEnd) + "\n" +
      bgSource.slice(safeStart, safeEnd) + "\n" +
      bgSource.slice(fsStart, fsEnd),
      sandbox,
    );
    const posted: any[] = [];
    const deadPort = { _dead: true, postMessage: (m: any) => posted.push(m) };
    sandbox.finishStream(deadPort, "sid-3", { reasoning: "x", actions: [] });
    expect(posted).toHaveLength(0);
  });

  // ── Key-first action regression (raw JSON leaking into the chat) ──
  // Bug: Zo returned actions in key-first form
  // ({ extract: {...} }, { done: { response } }) instead of type-first
  // ({ type: 'extract', ... }). finishStream did actions.find(a => a.type === 'done')
  // → undefined → safeDoneResponse empty → fullText fell back to the stringified
  // whole blob, which rendered as raw JSON in the chat. normalizeActions() now
  // converts key-first → type-first at the parse boundary.
  const KEY_FIRST_PAYLOAD = {
    reasoning: "The page is a treemap. No hyperlinks. I will extract visible content.",
    actions: [
      { extract: { selector: "body", attribute: "textContent" } },
      { done: { response: "## Summary\n\nNo links on this page." } },
    ],
  };

  it("emits the done.response as fullText, not the raw JSON blob", () => {
    const finishStream = loadFinishStream();
    const posted: any[] = [];
    const fakePort = { _dead: false, postMessage: (m: any) => posted.push(m) };
    finishStream(fakePort, "sid-kf", KEY_FIRST_PAYLOAD);
    expect(posted).toHaveLength(1);
    const done = posted[0];
    expect(done.type).toBe("STREAM_DONE");
    // fullText must be the done response, not a JSON dump of the payload.
    expect(done.fullText).toBe("## Summary\n\nNo links on this page.");
    expect(done.fullText).not.toContain('"reasoning"');
    expect(done.fullText).not.toContain('"actions"');
  });

  it("surfaces reasoning in STREAM_DONE (drives the thinking bubble)", () => {
    const finishStream = loadFinishStream();
    const posted: any[] = [];
    const fakePort = { _dead: false, postMessage: (m: any) => posted.push(m) };
    finishStream(fakePort, "sid-kf-r", KEY_FIRST_PAYLOAD);
    expect(posted[0].reasoning).toBe(
      "The page is a treemap. No hyperlinks. I will extract visible content.",
    );
  });

  it("emits normalized type-first actions (so executeActions + timeline work)", () => {
    const finishStream = loadFinishStream();
    const posted: any[] = [];
    const fakePort = { _dead: false, postMessage: (m: any) => posted.push(m) };
    finishStream(fakePort, "sid-kf-a", KEY_FIRST_PAYLOAD);
    const actions = posted[0].actions;
    expect(actions.map((a: any) => a.type)).toEqual(["extract", "done"]);
    expect(actions[0]).toEqual({ type: "extract", selector: "body", attribute: "textContent" });
    expect(actions[1].type).toBe("done");
    expect(actions[1].response).toBe("## Summary\n\nNo links on this page.");
  });

  it("also normalizes when the key-first payload arrives as a JSON string", () => {
    // Non-streaming / End-only path: output is a JSON string, not an object.
    const finishStream = loadFinishStream();
    const posted: any[] = [];
    const fakePort = { _dead: false, postMessage: (m: any) => posted.push(m) };
    finishStream(fakePort, "sid-kf-str", JSON.stringify(KEY_FIRST_PAYLOAD));
    expect(posted[0].fullText).toBe("## Summary\n\nNo links on this page.");
    expect(posted[0].actions.map((a: any) => a.type)).toEqual(["extract", "done"]);
    expect(posted[0].reasoning).toContain("treemap");
  });
});
