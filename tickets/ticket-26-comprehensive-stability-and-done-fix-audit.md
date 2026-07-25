# #26 — Comprehensive Stability & "Done." Response Audit

**Date:** 2026-07-26  
**Severity**: 🔴 Critical  
**Labels**: `bug`, `stability`, `quality`, `regression`  
**Effort**: Medium  

## Summary

Comprehensive audit of the full extension codebase after tickets #23, #24, and #25 fixes were applied (including uncommitted working-tree fixes). **Remaining issues: 4 P0, 4 P1, 5 P2.**

Tests pass at 140/140.

---

## 🔴 CRITICAL (P0 — features broken or silently failing)

### P0-A — `streamPort.postMessage` throws unhandled, leaving UI permanently disabled

**Files**: `extension/sidepanel.js` (line ~1993)  
**Status**: ❌ **Unfixed**

The streaming path in the override `sendQuery` calls `streamPort.postMessage({...})` without a try/catch:

```javascript
if (streamPort) {
  // ...
  streamPort.postMessage({  // <— throws if port disconnected
    sessionId: thisSessionId,
    type: 'ASK_ZO',
    // ...
  });
  return;
}
```

If the port disconnected between the `if (streamPort)` check and the `.postMessage()` call (MV3 SW termination, race condition), the error propagates as an unhandled promise rejection. All `disabled` flags remain true, permanently freezing the UI.

**Fix**: Wrap in try/catch, fall back to non-streaming path on failure.

---

### P0-B — "Done." still shown when Zo returns empty/undefined output

**Files**: `extension/sidepanel.js` (lines ~2074, ~2081)  
**Status**: ❌ **Unfixed**

In both the streaming and non-streaming paths, "Done." is shown when Zo returns a response with no `reasoning`, no `response` field, and no `actions`:

```javascript
// Non-streaming fallback:
if (!actions.length) {
  addMessage('assistant', reasoning || doneResponse || 'Done.');
}

// Streaming STREAM_DONE handler (else branch, no msgEl):
} else {
  addMessage('assistant', 'Done.');
}
```

When the Zo API responds but `data.output` is empty, undefined, or non-parseable, there's no distinguishing "empty response" from "successful completion." The user sees "Done." with no useful feedback.

**Fix**: Show `"Done. (no content returned)"` or similar to differentiate empty responses. Log the raw output to console for debugging.

---

### P0-C — `markdownToHtml` can throw from regex input, silently crashing STREAM_DONE

**Files**: `extension/sidepanel.js` (line ~1341+)  
**Status**: ❌ **Unfixed**

The `markdownToHtml` function uses regex replacements that can throw on complex or deeply nested inputs. If `body.innerHTML = markdownToHtml(responseText)` throws in the STREAM_DONE handler, the entire `handleStreamMessage` function silently fails — no error shown, "Done." never gets replaced.

Example problematic inputs: malformed markdown tables, deeply nested brackets, regex backtracking attacks.

**Fix**: Wrap `markdownToHtml` calls in try/catch, fall back to escaped plain text.

---

### P0-D — MV3 Service Worker terminates during long streaming requests

**Files**: `extension/background.js`  
**Status**: ❌ **Unfixed**

MV3 service workers have a 30-second idle timeout and a 5-minute event lifetime. `_askZoStreamImpl` runs a long-lived `fetch()` + SSE read loop that can exceed these limits (especially for model responses with 8K characters of page context + long reasoning). When the SW terminates mid-stream:

1. The SSE reader drops — response never reaches the sidepanel
2. The port disconnects — sidepanel's `onDisconnect` fires
3. Sidepanel's `streamSession.active` becomes false
4. Any subsequent `STREAM_DONE` from a reconnect is dropped

The `askZoStream` retry mechanism (3 retries, exponential backoff) only handles fetch-level errors, not SW termination.

**Fix**: Add MV3 keepalive heartbeat during streaming (pings chrome.storage every 30s). Or implement a SW-agnostic message flow using `chrome.runtime.sendMessage` as a secondary channel.

---

## 🟡 HIGH (P1 — features partially broken)

### P1-A — Response messages lack `sessionId`, enabling stale session leaks

**Files**: `extension/background.js` (`finishStream`, SSE parser)  
**Status**: ❌ **Unfixed**

Background.js sends `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages WITHOUT the `sessionId` field:

```javascript
port.postMessage({ type: 'STREAM_CHUNK', text: fullText });            // no sessionId
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText }); // no sessionId
```

The sidepanel's guard in `handleStreamMessage` checks `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;`. Since `msg.sessionId` is always undefined, the condition is always false — ALL messages pass the guard. If the user fires two queries rapidly, session 1's `STREAM_DONE` can arrive during session 2, overwriting content with stale data.

**Fix**: Include `sessionId` from the original `ASK_ZO` message in all response messages from background.js.

---

### P1-B — `handleStreamActions` `setTimeout` race with `STREAM_DONE` cleanup

**Files**: `extension/sidepanel.js` (lines ~1878-1885)  
**Status**: ❌ **Unfixed**

```javascript
function handleStreamActions(actions, reasoning) {
  // ...
  if (navigateActions.length) {
    addMessage('assistant', `📍 Navigating to: ${...}`);
    chrome.runtime.sendMessage({ type: 'NAVIGATE', url: ... }).catch(() => {});
    setTimeout(async () => {
      await refreshPageContext();
      if (doneResponse) addMessage('assistant', doneResponse);  // <— race
    }, 2000);
    return;
  }
```

The `setTimeout(2000ms)` fires after `handleStreamActions` returns. By that time, `STREAM_DONE` has already cleaned up the session: `streamSession.active = false`, `streamSession.msgEl = null`, input re-enabled. The `addMessage` in the timeout adds a DUPLICATE assistant message for the `doneResponse`.

This is also called from both `handleStreamMessage` (STREAM_DONE handler) AND the non-streaming fallback in `sendQuery`, which can trigger the `setTimeout` TWICE for the same response.

**Fix**: Add a guard flag (`stopDuplicateNavigateMessage`) or pass response handling to a single code path.

---

### P1-C — No error handling for stale/empty `currentContext`

**Files**: `extension/sidepanel.js` (sendQuery override, lines ~1906-1915)  
**Status**: ⚠️ **Partially fixed**

The sendQuery override checks `if (!currentContext) { addMessage('error', ...); return; }`. But `currentContext` is set by `refreshPageContext()` which can succeed with an empty context (e.g., on `chrome://` or `about:blank` pages). The Zo API receives `{ url: ?, title: ?, visibleText: "—empty—" }` and may return an empty response.

**Fix**: Check `currentContext.visibleText` and show a warning to the user before sending empty context to Zo.

---

### P1-D — No timeout on `chrome.runtime.sendMessage` fallback

**Files**: `extension/sidepanel.js` (line ~2001)  
**Status**: ❌ **Unfixed**

The non-streaming fallback path calls `await chrome.runtime.sendMessage(...)` with no timeout. If the background service worker is gone (terminated, not yet restarted), the message channel stays open indefinitely — the user's "Zo is thinking..." indicator persists forever.

**Fix**: Add a timeout wrapper around `chrome.runtime.sendMessage`.

---

## 🟢 MEDIUM (P2 — quality/edge cases)

### P2-A — Dead code: `domActions` computed but never used in STREAM_DONE

**Status**: ❌ **Unfixed** — Line ~1759: `const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');` is unused.

### P2-B — Conversation persistence misses action-only responses

**Status**: ❌ **Unfixed** — `STREAM_DONE` only persists `responseText`. If the response has actions but no display text, the conversation loses the exchange.

### P2-C — `cancelStream` does not reset `streamSession.sessionId`

**Status**: ❌ **Unfixed** — `cancelStream()` sets `active = false` but doesn't increment `sessionId`. A subsequent quick-cancel-query can receive old session responses.

### P2-D — `startNewConversation` races with active streaming

**Status**: ❌ **Unfixed** — `startNewConversation()` calls `cancelStream()` but doesn't wait for the port to fully settle before sending `NEW_CONVERSATION`.

### P2-E — Missing TypeScript type strictness

**Status**: ⚠️**Known** — The entire codebase is plain JS. No JSDoc type annotations on key function parameters, making static analysis impossible.

---

## Fix Plan

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0-A | try/catch port.postMessage | Low | High — prevents UI freeze |
| P0-B | Better "Done." fallback | Low | High — distinguishes empty response |
| P0-C | try/catch markdownToHtml | Low | Medium — prevents silent failures |
| P1-A | sessionId in response messages | Medium | Medium — prevents stale leaks |
| P1-B | Navigate setTimeout race | Medium | Medium — prevents duplicate messages |
| P1-C | Empty context warning | Low | Low — better UX |
| P0-D | SW keepalive during streaming | High | Medium — prevents mid-stream drops |
