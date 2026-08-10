# #26 — Code Quality & Stability Final Audit

**Date:** 2026-07-26
**Severity:** 🔴 Critical — 2 remaining P0 defects, 2 P1, 5 P2/P3
**Labels:** `bug`, `stability`, `quality`, `regression`

## 🔴 P0 — Features Broken

### P0-A — STREAM_DONE silently dropped when port disconnects mid-stream

**Files:** `extension/sidepanel.js` (lines ~1763-1768)
**Status:** ❌ Unfixed in committed code ✅ Fixed in working tree (uncommitted)

**Symptom:** User sees SSE events in console but sidepanel shows "Done." because `streamSession.active` becomes `false` when the port disconnects, causing `STREAM_DONE` to be silently dropped.

**Fix (in working tree):** The `if (!streamSession.active) return;` guard now shows the response via fallback `addMessage` instead of silently dropping it. But the input re-enable and cleanup need to also happen there.

**Remaining gap:** The `STREAM_DONE` handler's `else` branch (when `streamSession.msgEl` is null) still shows "Done." when `responseText` is empty AND `msg.actions` is empty. This is the last vector for the "Done." symptom. Fix: change `addMessage('assistant', 'Done.')` to show the raw output or an error message instead.

### P0-B — Non-streaming fallback shows "Done." when Zo returns empty output

**Files:** `extension/sidepanel.js` (line 2082)
**Status:** ❌ Unfixed

**Symptom:** The non-streaming fallback (used when `streamPort` is unavailable) shows "Done." when `resp.output` is empty/undefined AND reasoning cannot be parsed.

**Root cause:** When `askZo()` returns `{ success: true, output: undefined }` (Zo API returns empty output), `output` is `undefined`. Neither `typeof 'object'` nor `typeof 'string'` matches, so parsing is skipped entirely. `reasoning = ''`, `actions = []`, `doneAction = undefined`, `doneResponse = ''`. Falls to `addMessage('assistant', '' || '' || 'Done.')` = "Done."

**Fix:** Add an else clause that treats non-string/non-object output as fallback text:
```javascript
} else if (output) {
  reasoning = String(output);
} else {
  reasoning = ''; // will fall through to doneResponse or 'Done.'
}
```
Also improve the final fallback to check `resp` for any text content before showing "Done."

## 🔴 P1 — Stability Issues

### P1-A — No `sessionId` in STREAM_* response messages from background

**Files:** `extension/background.js` (lines: finishStream, STREAM_CHUNK, STREAM_ERROR)
**Status:** ❌ Unfixed

**Symptom:** Stale SSE responses from previous sessions leak into the current streaming session because `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages don't carry a `sessionId`. The sidepanel's session guard (`if (msg.sessionId && ...)`) never filters these because `msg.sessionId` is always `undefined`.

**Consequence:** If a user sends two queries quickly, the first query's response can overwrite the second query's display, or vice versa.

**Fix:** Include `sessionId` in all `port.postMessage` calls in background.js:
- `STREAM_CHUNK` → add `sessionId` field
- `STREAM_DONE` → add `sessionId` field
- `STREAM_ERROR` → add `sessionId` field

The `sessionId` must be passed through `_askZoStreamImpl(port, msg)` → the message object already has `msg.sessionId`.

### P1-B — `handleStreamActions` and `STREAM_DONE` compete to add the same response message

**Files:** `extension/sidepanel.js` (lines ~1776-1812, ~1878-1918)
**Status:** ⚠️ Partially fixed

**Symptom:** When Zo returns actions (including a `done` action with `response`), both `STREAM_DONE` handler and `handleStreamActions` may add the same message to the conversation and UI.

**The navigate path:** `handleStreamActions` adds `📍 Navigating to: ...` then schedules a `setTimeout` that adds the `doneResponse` message. Simultaneously, the `STREAM_DONE` handler may also update `streamSession.msgEl` with the same `responseText`. Result: duplicate messages.

**Fix:** In `handleStreamActions`, when there are navigate actions, don't schedule a `setTimeout` to add the done response — let the `STREAM_DONE` handler handle it. Or vice versa: let `handleStreamActions` handle the user-facing message and skip the `STREAM_DONE` message body update.

## 🟡 P2 — Quality Issues

### P2-A — `streamPort.postMessage` has no try/catch in sendQuery

**Files:** `extension/sidepanel.js` (line ~1986)
**Status:** ❌ Unfixed

**Symptom:** If `streamPort.postMessage({...})` throws (port disconnected between the `if (streamPort)` check and the `postMessage` call), the error propagates as an unhandled rejection. `input.disabled` is never reset, so the UI is permanently stuck in a disabled state.

**Fix:** Wrap in try/catch:
```javascript
if (streamPort) {
  try {
    streamPort.postMessage({...});
  } catch {
    // Port died between check and send — fall through to non-streaming path
    connectStreamingPort();
    if (streamPort) {
      streamPort.postMessage({...});
      return;
    }
    // If still can't connect, fall through to the non-streaming path below
  }
  return;
}
```

### P2-B — Duplicate `addMessage('user', query)` for bang commands that fall through

**Files:** `extension/sidepanel.js` (line ~1982)
**Status:** ❌ Unfixed

**Symptom:** When a bang command (e.g., `!preset summarize`) is used, `effectiveQuery = bang.query` is set but the user message shown is `addMessage('user', query)` — the original `!preset ...` text including the bang prefix. This is misleading because Zo sees `effectiveQuery` (without the prefix) but the user sees the full text.

**Fix:** Change `addMessage('user', query)` to `addMessage('user', effectiveQuery)` for consistency with what Zo actually processes.

### P2-C — `domActions` computed but unused in STREAM_DONE handler

**Files:** `extension/sidepanel.js` (line ~1759)
**Status:** ⚠️ In working tree (uncommitted)

**Symptom:** `const domActions = (msg.actions || []).filter(...)` is computed on every `STREAM_DONE` event but never used. It was probably intended for the action rendering logic but the variable is dead.

**Fix:** Remove the unused `domActions` computation, or use it to determine whether to show the actions bar.

### P2-D — Conversation persistence misses action-only responses

**Files:** `extension/sidepanel.js` (line ~1816)
**Status:** ❌ Unfixed

**Symptom:** The STREAM_DONE handler only persists the assistant response to `chrome.storage.local` when `responseText` is non-empty. If Zo returns actions with no text (e.g., `{actions: [click, fill, done]}` with empty response), the conversation is not saved.

**Fix:** Also persist when `msg.actions.length > 0` with a synthesized text from the reasoning.

## 🟢 P3 — Minor / Cosmetic

### P3-A — `THINKING_TIMEOUT_MS` (60s) declared but never used in streaming path

**Files:** `extension/sidepanel.js` (line 23)
**Status:** ❌ Unfixed

### P3-B — No version field in stored conversations

**Files:** `extension/sidepanel.js`
**Status:** ❌ Unfixed

Conversation objects stored in `chrome.storage.local` have no schema version. Future format changes could corrupt stored data. Add `version: 1` to conversation schema on creation.

### P3-C — `cancelStream` doesn't reset `streamSession.sessionId`

**Files:** `extension/sidepanel.js` (line ~2099)
**Status:** ⚠️ Partial fix in working tree

When a stream is cancelled (new conversation, switching conversations), `streamSession.sessionId` is not incremented. The next query reuses the same sessionId, but the state is reset so stale messages from before are ignored.

## Summary

| ID | Severity | Area | Status |
|----|----------|------|--------|
| P0-A | 🔴 Critical | STREAM_DONE dropped when port disconnects | ✅ Working tree fix (but "Done." fallback still reachable) |
| P0-B | 🔴 Critical | Non-streaming fallback "Done." for empty output | ❌ Unfixed |
| P1-A | 🔴 High | No sessionId in response messages | ❌ Unfixed |
| P1-B | 🔴 High | Duplicate messages from handleStreamActions + STREAM_DONE | ⚠️ Partially fixed |
| P2-A | 🟡 Medium | streamPort.postMessage no try/catch | ❌ Unfixed |
| P2-B | 🟡 Medium | Bang command user message shows raw prefix | ❌ Unfixed |
| P2-C | 🟡 Medium | Dead variable domActions | ⚠️ In working tree |
| P2-D | 🟡 Medium | Action-only responses not persisted | ❌ Unfixed |
| P3-A | 🟢 Low | THINKING_TIMEOUT unused in streaming path | ❌ Unfixed |
| P3-B | 🟢 Low | No schema version in stored conversations | ❌ Unfixed |
| P3-C | 🟢 Low | cancelStream doesn't increment sessionId | ❌ Unfixed |

## Next Steps

1. Fix P0-B — non-streaming fallback "Done." for empty output
2. Fix P1-A — add sessionId to all response messages
3. Fix P1-B — eliminate duplicate messages
4. Fix P2-A — try/catch around streamPort.postMessage
