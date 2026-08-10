# Streaming

Streaming is the **primary** path for Zo responses: Zo emits token-by-token
increments over Server-Sent Events (SSE), and the side panel renders them
live. The non-streaming `askZo()` path is retained as a fallback.

## How it works

```
sidepanel.js                background.js               Zo API
    │  ASK_ZO (with modeId)     │                          │
    ├──────────────────────────>│  POST /zo/ask (stream)    │
    │                           ├──────────────────────────>│
    │   streamPort (Port)       │  SSE events (PartStart/   │
    │<── STREAM_CHUNK ──────────│  PartDelta/ToolCall/... ) │
    │<── STREAM_DONE ───────────│                          │
```

The extension opens a long-lived `chrome.runtime.Port` (`streamPort`) from the
side panel to the background worker. The worker fetches `/zo/ask` with
`stream: true`, reads the SSE stream, and pipes each event back over the port.

## Redesigned for correctness

The streaming path was hardened end-to-end after a QA audit round. The
invariants:

### 1. Per-query session isolation

Every streaming round-trip carries a unique `sessionId`, echoed on **every**
`STREAM_*` message. The side panel only applies a message to the UI if its
`sessionId` matches the *current* query — so a late `STREAM_DONE` from a
previous query can never render into the next conversation. You'll never see
answer A's end-of-stream clobber query B's answer.

### 2. Port-disconnect safety

The shared `chrome.runtime.Port` can disconnect mid-stream (service worker
lifetime limits, tab switches). All postings go through `safePost()` which
**no-ops on dead ports** instead of throwing. `port.onDisconnect` marks the
port `_dead` so the panel can re-establish it.

### 3. Retry only transient errors

`isRetriableStreamError()` distinguishes transient failures (network, 5xx) from
permanent ones (401, 4xx, bad request). Only transient errors trigger a retry,
and the extension emits `STREAM_RECONNECT` before retrying so the UI can show
it's recovering. Permanent errors surface a **"Response interrupted"** card
with a **Retry** button.

### 4. No silent data loss

`fullText` is guarded against being overwritten by a trailing incomplete
payload. `STREAM_DONE` normalizes the final payload to a canonical
`responseText` so the rendered answer always contains the complete, correct
text.

### 5. 60-second liveness timeout

If the thinking indicator has shown for 60s with no new chunks, the extension
treats the stream as hung and recovers (rather than spinning forever).

## SSE event types

Zo's real streaming API emits typed events. The extension discovered them live
(on 2026-08-09) rather than trusting the older docs:

| Event | Purpose |
|-------|---------|
| `PartStartEvent` | Starts a content part (`thinking`, `text`, `tool-call`, `tool-return`). The first token of each part must be routed by `part_kind` |
| `PartDeltaEvent` | Incremental content delta — the workhorse. Delta `part_delta_kind`: `thinking` (live reasoning channel, index 0) vs `text` (answer channel, index 1) |
| `FunctionToolCallEvent` | A tool was invoked — surfaced as the "Explored" channel |
| `FunctionToolResultEvent` | A tool returned — surfaced as a tool result |
| `AgentRuntimeStreamChunk` | Lifecycle metadata (`status` / `persisted`), not rendered |
| `completed` | **Terminal** signal (`status: succeeded | failed`) |

The terminal event is `completed`, not `End` and not `[DONE]`. The old
`FrontendModelResponse` / `End` / `Error` events are **never emitted** by the
live API — the extension keeps handlers for them only to support synthetic test
fixtures.

## Live progress indicator

While streaming, the panel shows a **live processing timer** and a thinking
indicator. If no thinking is available from the backend, there's a liveness
indicator so you know the query is still running.

## Reasoning — inline, not a separate bubble

The `reasoning` field Zo returns alongside actions arrives in the final
`STREAM_DONE` payload (it doesn't stream incrementally yet). It is rendered via
`addReasoningBubble`:

- **Short reasoning** → muted inline prose above the answer
- **Longer reasoning** → collapses into a "💭 Thought" trace header

It's rendered through the same escaping/Markdown path as assistant messages, and
persisted with the message so it re-renders from history.

## Action JSON suppression

While Co-browse mode streams, the model may emit the `{actions:[...]}` JSON
envelope as raw text deltas **before** the final parse. `looksLikeActionJson()`
detects this and **suppresses rendering it as prose** — otherwise raw JSON would
flash across the chat live. The actions are instead executed and surfaced as an
action timeline, with the done-text as the final prose.

## Viewing stream shape

The extension records which event types/fields Zo actually emits
(`emitStreamDiagnostic` → `STREAM_DIAGNOSTIC` → `streamShape`). This is the
"SSE shape discovery" mechanism used to close the gap between what Zo sends and
what the extension renders.
