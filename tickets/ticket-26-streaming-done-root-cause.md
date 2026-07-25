# #26 — Streaming 'Done.' Root Cause Analysis & Remaining Defects

**Date:** 2026-07-26
**Severity**: 🔴 Critical
**Status**: Some fixes in working tree (uncommitted), 3 defects still unfixed
**Labels**: `bug`, `streaming`, `done`, `stability`

## Summary

Despite multiple fix rounds (tickets #23, #24, #25), the sidepanel still shows "Done." instead of Zo's response **when the port is disconnected during streaming**. The current fixes address the SSE parser and content extraction, but the port-disconnect race condition remains.

---

## 🔴 Critical (P0 — Extension broken)

### C1 — Port disconnect during streaming silently drops the final response

**Symptom**: User sees "eventstream in console" (SSE events reach background SW) but sidepanel shows "Done." after "Zo is thinking..."

**Root cause**: MV3 background service workers have a 30-second idle timeout and 5-minute event processing limit. When the SW is terminated:
1. The port between sidepanel and background disconnects
2. `streamPort.onDisconnect` fires in sidepanel → sets `streamSession.active = false`
3. The background SW's fetch continues but `port.postMessage()` silently fails
4. When the SW restarts, the streaming response is gone forever
5. Sidepanel never receives STREAM_DONE, and the early return in sendQuery prevents the non-streaming fallback from running

**Fix (partial — in working tree)**: STREAM_DONE handler now has a fallback for inactive sessions. But the fundamental problem is that STREAM_DONE never arrives because the port is dead.

**Remaining gap**: No automatic retry mechanism. When port disconnects mid-stream, the query is lost with no recovery.

### C2 — Port reconnection produces duplicate responses

**Symptom**: After port reconnect, the same SSE response may arrive on both the old (failing) port and the new port, causing duplicate assistant messages.

**Root cause**: `_askZoStreamImpl` doesn't abort the previous fetch when the port disconnects. If connectStreamingPort() is called again (new port), a second fetch may start while the first is still running. Both may produce STREAM_DONE, creating duplicate messages.

**Fix needed**: Abort the in-progress fetch when port disconnects. Use AbortController.

### C3 — "Done." fallback too generic

**Files**: `sidepanel.js` STREAM_DONE handler (line ~1826), `sidepanel.js` non-streaming fallback (line ~2079)

The "Done." fallback at line ~1826 shows when:
- `streamSession.msgEl` is null (no streaming chunks received)
- `responseText` is empty
- `msg.actions` is empty or has no items

This should say something more descriptive, like "Response empty — Zo may have returned no output. Check the extension console for details."

**Fix needed**: Replace "Done." with a more descriptive fallback.

---

## 🟡 High (P1 — Feature-broken or data loss)

### P1-A — Cannot recover from port disconnect mid-stream

When port disconnects mid-stream, the sidepanel never gets `STREAM_DONE`. The thinking indicator stays forever (though partially fixed to remove it via onDisconnect cleanup). The user must manually start a new conversation.

**Fix needed**: After port disconnect, automatically retry the query via `chrome.runtime.sendMessage` (non-streaming) using the saved query and context.

### P1-B — No `sessionId` in STREAM_CHUNK/STREAM_DONE/STREAM_ERROR

Background.js `_askZoStreamImpl` receives `msg.sessionId` from the sidepanel but doesn't include it in any response messages. This means:
- The sidepanel's `msg.sessionId && msg.sessionId !== streamSession.sessionId` guard never filters response messages
- Stale responses from previous sessions leak into the current UI
- Rapid-fire queries produce interleaved response content

**Fix**: Add `sessionId: msg.sessionId` to every `port.postMessage()` call in `_askZoStreamImpl` and `finishStream`.

### P1-C — Conversation persistence drops action-only responses

When Zo returns only actions (no text response), `responseText` is empty and the STREAM_DONE handler's "Persist to conversation" block skips saving. The conversation history is incomplete.

**Fix**: Always persist assistant messages to conversation, even when `responseText` is empty but `actions` has items.

### P1-D — Non-streaming path hardcodes `streamSession.active = false`

Line ~2044 (sidepanel.js): `streamSession.active = false;` is called AFTER streaming path returns early. This is dead code in the streaming path but runs in the non-streaming fallback. If streaming tries to use `streamSession` after a non-streaming query, the state is wrong.

**Fix**: Guard the `streamSession.active = false` behind a check that streaming was actually attempted.

---

## 🟡 Medium (P2 — Polish & maintainability)

### P2-A — `domActions` declared but never used in STREAM_DONE

Line ~1760 (sidepanel.js): `const domActions = (msg.actions || []).filter(...)` is computed but never referenced.

**Fix**: Remove dead code or use it for assertion/validation.

### P2-B — `handleStreamActions` drops DOM actions when navigate action is present

If Zo returns both navigate AND DOM actions, `handleStreamActions` processes the navigate action and returns early. The DOM actions are silently dropped.

**Fix**: Process navigate action first, then handle remaining DOM actions on the new page after navigation completes.

### P2-C — No AbortController on SSE stream

`_askZoStreamImpl` has no mechanism to abort an in-flight SSE fetch when the port disconnects. The fetch continues reading and accumulating data even when nobody is listening.

**Fix**: Pass an AbortSignal that triggers on port disconnect.

### P2-D — `finishStream` doesn't include `sessionId` parameter

`finishStream(port, output, intent)` doesn't receive `sessionId`, so it cannot include it in the STREAM_DONE message. This requires all 5 callers to be updated.

### P2-E — MV3 SW lifecycle kills background processing after 30s idle

Any streaming response that takes >30s (model thinking, context window) may be cut off by the SW lifecycle. The SSE fetch silently fails and the port disconnects.

**Fix**: Use `chrome.runtime.getBackgroundPage()` or `self.keepalive` patterns to keep the SW alive during streaming.

---

## 🟢 Low (P3 — Nice to have)

### P3-A — Hardcoded API URLs in options.js test connection

options.js uses hardcoded `'https://api.zo.computer/zo/ask'` instead of reading from the saved config. Users with custom API endpoints get false results from Test Connection.

### P3-B — File picker regex matches `event:` without trailing space

The SSE parser was updated to handle `event:` (no space) as well as `event: ` (with space). This is non-standard SSE but exists as a defensive measure. Should be tested against actual Zo API responses.

---

## Verification Steps

1. **Streaming port disconnect recovery**:
   - Open extension in Chrome, load a page
   - Ask Zo a question
   - While "Zo is thinking..." is shown, terminate the service worker from `chrome://serviceworker-internals`
   - Verify: Sidepanel recovers and shows the response via non-streaming path

2. **Rapid-fire queries**:
   - Send 3 queries rapidly (before each completes)
   - Verify: No duplicate or interleaved messages; only the latest query's response is shown

3. **Action-only responses**:
   - Send "Click the first link on this page"
   - Verify: Action is executed AND conversation history shows the request

4. **Empty response handling**:
   - Use a model that doesn't support streaming with `stream: true`
   - Verify: Shows an error message, not "Done."

5. **Add message DOM is visible for non-streaming path**:
   - Disconnect port (e.g., reload extension)
   - Send a query
   - Verify: Response appears via `addMessage('assistant', ...)` fallback
