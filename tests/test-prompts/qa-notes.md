# QA Notes — Real Zo SSE stream protocol discovery

**Capture date:** 2026-08-09
**Source:** live `POST https://api.zo.computer/zo/ask` with `stream:true`, `Authorization: Bearer ${ZO_API_KEY}`
**Captures:** 8 use cases (all 6 builtin modes + both cobrowse intents)

**Addendum 2026-08-19 — `failed` terminal event (live-verified):** server-side run
failures do NOT use HTTP errors. The API returns **200 + text/event-stream** and
terminates with `event: failed`, `data: {"status":"failed","error":"Unknown
model: nonexistent-model-xyz","runner_id":"…","error_type":"UserError","failure_owner":"ours","failure_kind":"unknown_model"}` (reproduced by sending a bogus
`model_name`). Until background.js gained a `failed`-terminal handler, these
surfaced as the "Zo returned an empty response" hint with the real error dropped.
Plain asks re-verified same day: protocol unchanged (PartStart/PartDelta/completed).
See also the `status:"failed"`-inside-`completed` defensive branch.

## ⚠️ CRITICAL FINDING — the documented SSE protocol is wrong

`extension/AGENTS.md:35-37` documents these SSE event types:

> Event types: `FrontendModelResponse` (text chunk in `data.content`), `End` (complete, has `data.output`), `Error` (`data.message`)

**None of these appear in any live capture.** Across 8 real streaming responses from `/zo/ask`, the events `FrontendModelResponse`, `End`, and `Error` were emitted **zero times**.

### What the API actually emits

| Event type | Count across 8 captures | Purpose |
|---|---|---|
| `PartDeltaEvent` | majority of all events | Incremental content delta (the real "chunk" event) |
| `PartStartEvent` | 2-4 per response | Starts a "part" (thinking, text, tool-call, tool-return) |
| `AgentRuntimeStreamChunk` | 3-6 per response | Lifecycle: `{type:"status"|"persisted", status, data:{message_id}}` |
| `FrontendModelRequest` | 1-2 per response | **Echo of the full request prompt** — see "Privacy scrubbing" below |
| `FunctionToolCallEvent` | 0-1 (research only) | Tool invocation |
| `FunctionToolResultEvent` | 0-1 (research only) | Tool result |
| `completed` | 1 (terminal) | Terminal signal: `{status:"succeeded", error:null}` |
| `End` | **0** | Documented, never emitted |
| `FrontendModelResponse` | **0** | Documented, never emitted |
| `Error` | **0** | Documented, never emitted (HTTP-level errors return non-200 instead) |

### The real content-carrying shape

The extension's parser (`extractStreamContent` in `background.js:79-101`) looks for `content`, `output`, `text`, `response`, `choices[0].delta.content`, etc. **None of these fields carry content in the real stream.** The actual content lives in:

```
event: PartDeltaEvent
data: {"delta":{"content_delta":"<text>","part_delta_kind":"text|thinking",...},"event_kind":"part_delta","index":<n>,...}
```

- `delta.content_delta` — the incremental text piece
- `delta.part_delta_kind` — `"thinking"` (reasoning channel) or `"text"` (answer channel)
- `index` — identifies which "part" (0=reasoning, 1=answer text, higher=tool calls)

`PartStartEvent` declares the part kind up front:
```
event: PartStartEvent
data: {"event_kind":"part_start","index":0,"part":{"content":"<first piece>","part_kind":"thinking|text|tool-call|tool-return|user-prompt",...},...}
```

### Reasoning streams incrementally (not only in STREAM_DONE)

`AGENTS.md` and `QA_REPORT.md` state reasoning "arrives only in the final `STREAM_DONE` payload — never streamed incrementally." **This is false against the live API.** Reasoning streams token-by-token as `PartDeltaEvent` with `part_delta_kind:"thinking"`, in a separate part (index 0) that precedes the answer text (index 1). All 8 captures show this pattern.

### Terminal signal is `event: completed`, not `event: End`

The stream terminates with:
```
event: completed
data: {"status":"succeeded","error":null,"runner_id":null,"error_type":null,...}
```

There is no `End` event, no `[DONE]` sentinel, and no `data.output` carrying the full assembled answer.

### Action envelope shape (cobrowse mode)

The real cobrowse response wraps the JSON action envelope in a **markdown code block** and the model is **non-deterministic** about the action object shape. Across captures, three forms have appeared:

1. **Key-first** (most common): `{"click":{"selector":"#pricing"}}`, `{"done":{"response":"..."}}`
2. **Type-first** (canonical): `{"type":"click","selector":"#pricing"}`
3. **Non-spec variant** (seen on multi-action): `{"action":"fill","selector":"#search-box","value":"Zo Computer"}` — note `"action"` (singular), not `"type"` and not key-first.

The envelope is also wrapped in a ```` ```json ... ``` ```` code fence, split across the `PartStartEvent` (carries the opening ```` ``` ```` in `part.content`) and subsequent `PartDeltaEvent` deltas.

Implications for the extension:
- The action JSON is fenced in ```` ```json ... ``` ```` — the parser must strip the code fence before `JSON.parse`.
- `normalizeActions()` in `lib/modes.js:185-210` handles key-first and type-first, but **not** the `{"action":"..."}` variant — those actions would be silently dropped. The prompt's `ACTION_SCHEMA_COMPACT` is ambiguous enough that the model emits all three.
- The cobrowse-readonly entry correctly downgrades to plain markdown (no action envelope) — confirmed in capture: `shouldDowngradeToJsonDisabled` causes `PLAIN_RESPONSE_HINT` to be sent, and the response is prose, not JSON.

## Privacy scrubbing (capture.ts)

The `FrontendModelRequest` event echoes the **entire request prompt**, including private workspace content that the API injects (observed: the user's `AGENTS.md` and `SOUL.md` project files — listing all projects, datasets, skills, plus personal/advocacy context). `capture.ts` scrubs:
- All `FrontendModelRequest` events (the request echo) — dropped entirely.
- All `id:` lines (per-event SSE IDs — noise).
- The `prompt` field in metadata `.json` files — truncated to 200 chars + `[REDACTED]`.

Verified post-scrub: zero matches for `CashlessConsumer`, `workspace`, `AGENTS.md`, `SOUL.md`, `Srikanth` across all committed fixtures.

## Per-use-case capture summary

Numbers below are from the latest capture run (re-runs are non-deterministic — the model produces different content each time, but the **event-type protocol is stable** across all captures).

| ID | Events | Completed | Actions | Reasoning | Tools | Text len |
|---|---|---|---|---|---|---|
| cobrowse-action | 214 | ✓ | yes | yes | 0 | 112 |
| cobrowse-action-sequence | 358 | ✓ | yes | yes | 0 | 292 |
| cobrowse-readonly | 125 | ✓ | no | yes | 0 | 705 |
| ask | 62 | ✓ | no | yes | 0 | 263 |
| research | 1026 | ✓ | no | yes | 1 | 4712 |
| summarize | 78 | ✓ | no | yes | 0 | 734 |
| extract | 264 | ✓ | no | yes | 0 | 2719 |
| visual | 130 | ✓ | no | yes | 0 | 1231 |

All 8 captures terminated with `event: completed` / `status:"succeeded"`. Reasoning (thinking channel) was present in **every** capture — the extension currently discards it because it looks for reasoning only in the (never-emitted) `End` payload.

## Implications for extension stream handling

This round is scoped to **documentation + fixtures only** (no extension code changes). The discovered gaps below are frozen as regression fixtures; a follow-up can patch the extension:

1. **`_askZoStreamImpl` byte-loop** (`background.js:876-981`) handles `End`/`Error`/`FrontendModelResponse`/`[DONE]` — none of which the real API emits. It will fall through to the "stream-close fallback" (`finishStream(port, sid, fullText)` at `:981`) with `fullText` empty, because `extractStreamContent` returns `""` for `PartDeltaEvent` shapes (no recognized field). **Result: every live stream currently surfaces as empty / falls back to the plain-text path.** This matches the historical "Done." empty-response bug (#29) reported before the synthetic tests were written.

2. **`extractStreamContent`** (`background.js:79-101`) does not recognize `delta.content_delta` or `delta.part_delta_kind`. A real fix would add: `if (parsed.delta?.content_delta) return parsed.delta.content_delta;` and route on `part_delta_kind`.

3. **Reasoning** is streamed incrementally as `part_delta_kind:"thinking"` — the extension's `STREAM_DONE`-only reasoning channel misses it entirely.

4. **Terminal detection** should key on `event: completed` (status succeeded/failed), not `End`/`[DONE]`.

5. **Action envelope** arrives as a code-fenced key-first JSON blob in the text channel — the current `finishStream` expects a raw JSON object/string, not markdown-fenced content.

These are the highest-value follow-ups surfaced by this capture round.
