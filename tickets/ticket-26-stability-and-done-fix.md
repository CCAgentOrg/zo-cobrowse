# #26 — Post-Fix Stability Audit & Remaining "Done." Display Defects

**Date:** 2026-07-26
**Severity:** 🔴 Critical (extension fails to display Zo responses, shows "Done." instead)
**Labels:** `bug`, `regression`, `stability`, `streaming`

## Summary

Comprehensive re-audit after ticket #24 (streaming/done response fix) and #25 (post-fix regression audit). Three previous audit tickets (#23, #24, #25) identified and fixed ~15 defects, but **5 remaining P0/P1 bugs** still prevent the extension from working reliably. The most visible symptom: "Done." is displayed instead of Zo's actual response, even when the SSE event stream arrives correctly at the background service worker.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-1 — `streamPort.postMessage()` throws, permanently disabling input

**Files:** `extension/sidepanel.js` (override `sendQuery`, ~line 1990)
**Status:** ❌ **Unfixed**

**Symptom:** If the background service worker restarts between the `if (streamPort)` check and the `.postMessage()` call, the port is dead and `postMessage` throws. The error propagates to the event handler, leaving `input.disabled = true` and `sendBtn.disabled = true` permanently. User can never send another query.

**Root cause:** No try/catch around the `streamPort.postMessage({...})` call. The port can disconnect at any time (MV3 SW termination, extension context invalidation).

**Fix:** Wrap in try/catch. On failure, fall through to the non-streaming `chrome.runtime.sendMessage` path and reconnect the port for next time.

```javascript
// Before:
streamPort.postMessage({ sessionId: thisSessionId, ... });
return;

// After:
try {
  streamPort.postMessage({ sessionId: thisSessionId, ... });
  return;
} catch {
  streamSession.active = false;
  connectStreamingPort();
  // fall through to sendMessage path
}
```

### P0-2 — Non-streaming fallback "Done." when Zo returns response without reasoning/actions fields

**Files:** `extension/sidepanel.js` (override `sendQuery`, non-streaming fallback)
**Status:** ⚠️ **Partially fixed** (ticket #24 added `doneResponse` fallback)

**Symptom:** Non-streaming fallback still shows "Done." when Zo returns `{output: {...}}` where the output object has no `reasoning` or `actions` fields. This happens with certain presets/instructions that don't request the JSON action schema.

**Root cause:** The fallback assumes Zo always returns JSON with `reasoning`/`actions`. When the output is a different shape (or a plain text string that isn't valid JSON), the code falls through to `'Done.'`.

**Fix:** Use `safeText(resp.output)` as the ultimate fallback before 'Done.'. If the output is an object, stringify it. If it's a string, use it directly.

```javascript
// After the existing parsing, before the 'Done.' fallback:
const output = resp.output;
const outputText = typeof output === 'object' && output !== null
  ? safeText(output.response) || safeText(output.reasoning) || safeText(JSON.stringify(output))
  : safeText(output);

if (!actions.length) {
  addMessage('assistant', reasoning || doneResponse || outputText || 'Done.');
}
```

---

## 🟡 HIGH (P1 — stability issues)

### P1-1 — Inactive session fallback in STREAM_DONE doesn't persist to conversation

**Files:** `extension/sidepanel.js` (STREAM_DONE handler, inactive session fallback)
**Status:** ❌ **Unfixed**

**Symptom:** When `streamSession.active` is false (port disconnected), the response appears in the UI via `addMessage()` but is NOT persisted to `chrome.storage.local` history. Reloading the sidepanel loses the response.

**Root cause:** The inactive session code path at lines ~1765-1780 calls `addMessage('assistant', ...)` which persists to conversation, BUT `actions.length > 0` branch calls `handleStreamActions()` which does NOT persist the done response (it only calls `addMessage` for navigate actions via setTimeout). So if the response has actions but no plain text, the response is displayed but never saved.

**Fix:** Add explicit persistence in the inactive session fallback for action-only responses.

### P1-2 — `domActions` computed but never used in STREAM_DONE handler

**Files:** `extension/sidepanel.js` (STREAM_DONE handler, line ~1759)
**Status:** ❌ **Unfixed**

**Symptom:** Dead code — variable `domActions` is computed at the top of `STREAM_DONE` but never referenced. The value should be used for the "response is in actions" branch at line ~1794.

**Root cause:** Refactored code left the computation orphaned.

### P1-3 — No `sessionId` in response messages from background.js

**Files:** `extension/background.js` (`_askZoStreamImpl`, `finishStream`)
**Status:** ❌ **Unfixed**

**Symptom:** STREAM_CHUNK, STREAM_DONE, and STREAM_ERROR messages from background.js lack a `sessionId` field. The sidepanel's guard `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;` is ineffective — all messages pass through regardless of session, allowing stale responses from previous sessions to leak into active sessions.

**Fix:** Include `sessionId` from the original `msg` in all port.postMessage calls inside `_askZoStreamImpl` and `finishStream`.

```javascript
// In _askZoStreamImpl:
port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId: msg.sessionId });
port.postMessage({ type: 'STREAM_ERROR', error: ..., sessionId: msg.sessionId });

// In finishStream:
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId: msg.sessionId });
```

### P1-4 — `_askZoStreamImpl` continues processing after port disconnects

**Files:** `extension/background.js` (`_askZoStreamImpl`)
**Status:** ❌ **Unfixed**

**Symptom:** When the port disconnects (MV3 SW termination), `_askZoStreamImpl` continues running — sending `port.postMessage` calls that silently fail (caught by try/catch inside `askZoStream`). This wastes resources on stale streaming responses.

**Fix:** Check for port disconnection after each chunk and abort the stream processing loop.

---

## 🟢 MEDIUM (P2 — quality issues)

### P2-1 — Duplicate `safeText` call in `addSystemMessage`

**Files:** `extension/sidepanel.js` (line ~1518)
**Status:** ✅ **Fixed** (in uncommitted working tree)

One line was already commented out leaving the duplicate.

### P2-2 — Theme popover click-outside listener leaks on rapid cycles

**Files:** `extension/sidepanel.js` (theme functions)
**Status:** ❌ **Unfixed**

Each `showThemePopover()` adds a `document.addEventListener('click', ...)`. If `closeThemePopoverOutside` fires after `closeThemePopover` has already removed the listener, the listener is never cleaned up for that cycle. Repeated rapid open/close cycles accumulate listeners.

### P2-3 — `chrome.runtime.connect` on every query recreates port

**Files:** `extension/sidepanel.js` (`sendQuery`)
**Status:** ❌ **Unfixed**

The streaming path calls `if (!streamPort) connectStreamingPort()` on every query. The first query creates the port. On subsequent queries, `streamPort` exists. But if the port was disconnected, it reconnects. This is fine but means every failed postMessage tries to reconnect. A more robust approach would track port health.

---

## Summary of Required Changes

| ID | File | Impact | Type |
|----|------|--------|------|
| P0-1 | sidepanel.js | 🔴 Input permanently disabled on port failure | try/catch wrap |
| P0-2 | sidepanel.js | 🔴 "Done." shown instead of actual text | Add fallback text |
| P1-1 | sidepanel.js | 🟡 Lost conversation history on disconnect | Add persistence |
| P1-2 | sidepanel.js | 🟡 Dead code | Remove unused variable |
| P1-3 | background.js | 🟡 Stale session leaks | Add sessionId |
| P1-4 | background.js | 🟡 Wasted resources on stale streams | Add disconnect check |
| P2-2 | sidepanel.js | 🟢 Event listener leak | Clean up properly |
