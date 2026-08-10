# #26 — Code Quality & Stability Re-Audit (Streaming & "Done." Root Causes)

**Date:** 2026-07-26  
**Severity**: 🔴 Critical (multiple P0/P1 defects still break the extension)  
**Status**: 🆕 New audit after tickets #23, #24, #25 fixes  
**Files**: `extension/sidepanel.js` (2109 lines), `extension/background.js` (1401 lines), `extension/content.js` (163 lines), `extension/options.js` (317 lines)

## Summary

Re-audit of the existing codebase after the fixes from tickets #23, #24, and #25 were applied (commits and uncommitted working tree changes). The primary symptom — sidepanel shows "Done." despite Zo API responding with valid output — persists due to **three fundamental architectural issues** and **five code-level defects** that the previous rounds of fixes didn't fully address.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-A — Streaming `STREAM_DONE` silently drops response when `streamSession.active` is `false`

**Files**: `extension/sidepanel.js` (lines 1763–1768 in working tree)  
**Status**: ❌ Partially fixed (uncommitted changes add inactive-session fallback, but the fallback still omits the streaming message body and loses conversation persistence)

**Symptom**: When the background service worker terminates between `STREAM_CHUNK` and `STREAM_DONE` (common in MV3 after ~30s idle), the port disconnects, `streamSession.active` is set to `false` by the `onDisconnect` handler, and the `STREAM_DONE` message is processed by the inactive-session fallback path that shows the response via `addMessage()` but loses the streaming message body context and doesn't save to conversation history.

**Root cause**: `streamSession.msgEl` is set to null when port disconnects. When STREAM_DONE arrives with `streamSession.active = false`, the fallback path calls `addMessage()` which works for plain text but doesn't update the already-showing streaming message body. For action-based responses, `handleStreamActions()` is called but may add duplicate messages.

**Fix**: The inactive-session fallback should:
1. Preserve accumulated `streamSession.fullText`
2. Reuse or replace the streaming message DOM element instead of creating a new one via `addMessage()`
3. Persist to conversation history even when `streamSession.active` is false

---

### P0-B — No `sessionId` in background-to-sidepanel response messages

**Files**: `extension/background.js` — `_askZoStreamImpl()` (lines ~890–920, `STREAM_CHUNK`/`STREAM_DONE`/`STREAM_ERROR` `port.postMessage()` calls)  
**Status**: ❌ Not addressed  

**Symptom**: When the user sends two queries in quick succession (rapid-fire), response messages from the first session leak into the second session's processing. The sidepanel's `handleStreamMessage` guard only filters based on `msg.sessionId`, but background.js **never includes `sessionId`** in any response message (`STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR`). The guard is completely ineffective for these messages.

**Root cause**: The sidepanel's `sendQuery` sends `sessionId` in the request `port.postMessage({sessionId, type: 'ASK_ZO', ...})`, but `_askZoStreamImpl` creates the response messages without copying `sessionId` from the request. The guard `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;` always passes because `msg.sessionId` is `undefined`.

**Fix**: Extract `sessionId` from the incoming ASK_ZO message and include it in all response messages:

```diff
+ const msgSessionId = msg.sessionId;
  // ...
  port.postMessage({ type: 'STREAM_CHUNK', text: fullText });
```
→ 
```diff
+ port.postMessage({ type: 'STREAM_CHUNK', sessionId: msgSessionId, text: fullText });
```

And similarly for `STREAM_DONE` and `STREAM_ERROR`.

---

### P0-C — Options page "Test Connection" still uses undeclared `DEFAULTS` (uncommitted fix works but may not be applied)

**Files**: `extension/options.js` (line 227)  
**Status**: ⚠️ Fixed in working tree (hardcoded URL), not committed  

**Root cause**: `options.js` references `DEFAULTS.zoApiUrl` but `DEFAULTS` is never defined in `options.js`. This throws a `ReferenceError` when the user clicks "Test Connection".

**Fix applied in working tree**: Replaced `DEFAULTS.zoApiUrl` with `'https://api.zo.computer/zo/ask'`.  
**Recommendation**: Either import `DEFAULTS` from a shared module or hardcode and add a test.

---

## 🟡 HIGH (P1 — partial breakage or silent failures)

### P1-A — Non-streaming fallback shows "Done." when Zo returns empty `output`

**Files**: `extension/sidepanel.js` override `sendQuery` (lines ~2076–2081)  
**Status**: ❌ Not addressed  

**Symptom**: When the streaming port is unavailable (MV3 SW terminated, port creation fails), code falls to `chrome.runtime.sendMessage({type: 'ASK_ZO'})`. If the Zo API returns `{output: ""}` or `{output: undefined}`, the fallback shows "Done." even though the response content could be set via error messages or conversation history.

**Root cause**: The fallback path checks `if (!actions.length)` and shows `reasoning || doneResponse || 'Done.'`. If Zo returns an empty output, `reasoning = ''`, `doneResponse = ''`, and `'Done.'` is shown. No attempt is made to show the raw response text or a more informative message.

**Fix**: Add a final fallback to the raw response text and a warning indicator:
```javascript
if (!actions.length) {
  const fallbackText = reasoning || doneResponse || safeText(resp.output) || 'Done.';
  addMessage('assistant', fallbackText);
}
```

---

### P1-B — Missing error handling for `streamPort.postMessage()`

**Files**: `extension/sidepanel.js` override `sendQuery` (line ~1987)  
**Status**: ❌ Not addressed  

**Symptom**: `streamPort.postMessage({type: 'ASK_ZO', ...})` can throw if the port disconnected between the `if (streamPort)` check and the `postMessage` call. The exception propagates uncaught, leaving `input.disabled = true` and `sendBtn.disabled = true` permanently — the UI becomes stuck.

**Root cause**: No try/catch around `streamPort.postMessage()`. A race window exists between the `if (streamPort)` guard and the actual `postMessage`.

**Fix**: Wrap in try/catch that falls through to the non-streaming path on failure:
```javascript
if (streamPort) {
  try {
    streamPort.postMessage({...});
    return;
  } catch {
    // Port disconnected — fall through to fallback
    streamPort = null;
    connectStreamingPort();
  }
}
```

---

### P1-C — Conversation persistence skipped for action-only responses

**Files**: `extension/sidepanel.js` `handleStreamMessage` STREAM_DONE handler (lines ~1817-1827)  
**Status**: ❌ Not addressed  

**Symptom**: When Zo returns a response with only structured actions (e.g., `{actions: [{type: "click", selector: "#btn"}]}`) and no `responseText`, the assistant message is not persisted to conversation history. The sidebar chat history has gaps where assistant responses should be.

**Root cause**: The persistence block only runs `if (responseText)`. Action-only responses produce empty `responseText` and are not saved.

**Fix**: Also persist action-based responses using `msg.reasoning` as fallback text:
```javascript
const persistText = responseText || msg.reasoning || safeText(msg.actions) || 'Action response';
if (persistText) {
  conv.messages.push({ role: 'assistant', text: persistText, timestamp: Date.now() });
}
```

---

## 🔵 MEDIUM (P2 — quality, edge cases, race conditions)

### P2-A — `addMessage` duplicate for `handleStreamActions` navigate + doneResponse

**Files**: `extension/sidepanel.js` — `handleStreamActions()` (line ~1877–1900), non-streaming fallback (lines ~2078–2084)  
**Status**: ❌ Not addressed  

**Symptom**: For navigate actions, `handleStreamActions()` sets a `setTimeout` that calls `addMessage('assistant', doneResponse)` after 2 seconds. But the STREAM_DONE handler ALSO calls `handleStreamActions`, and the caller may also call `addMessage`. This can produce duplicate assistant messages for the same response.

**Root cause**: The `navigate` branch in `handleStreamActions` uses `setTimeout` to add the doneResponse, but the streaming fallback also adds it synchronously. The `!hasNavigate` guard prevents the synchronous add for navigate scenarios, but the non-streaming fallback's `handleStreamActions` also enters the navigate branch, double-adding.

**Fix**: Make `handleStreamActions` track whether it already handled a navigate action, or remove the `setTimeout` and let the caller add the doneResponse.

---

### P2-B — `markdownToHtml` throws on malformed input (no try/catch in render paths)

**Files**: `extension/sidepanel.js` — STREAM_CHUNK handler (line ~1751), STREAM_DONE handler (line ~1782), streaming body update  
**Status**: ❌ Not addressed  

**Symptom**: If `markdownToHtml()` throws (e.g., catastrophic backtracking in regex from crafted input), the exception propagates through `handleStreamMessage`, crashing the event handler. Subsequent `STREAM_DONE`/`STREAM_CHUNK` messages are not processed, leaving the UI in a broken state.

**Root cause**: `body.innerHTML = markdownToHtml(safeText(msg.text));` and `body.innerHTML = markdownToHtml(responseText);` are not wrapped in try/catch.

**Fix**: Wrap in try/catch with a plain-text fallback.

---

### P2-C — `closeThemePopoverOutside` accumulates event listeners

**Files**: `extension/sidepanel.js` (lines ~94-97)  
**Status**: ❌ Not addressed  

**Symptom**: Every theme toggle open adds a new `document.addEventListener('click', closeThemePopoverOutside, true)`. Each handler calls `closeThemePopover()` repeatedly. Over many theme interactions, performance degrades.

**Root cause**: Multiple listeners are added without tracking. The `document.removeEventListener('click', closeThemePopoverOutside, true)` in `closeThemePopover()` only removes ONE instance (the `false` capture vs `true` in add — wait, they match). Actually it should only remove the most recent one. But if multiple are added, they all need to be removed.

**Fix**: Use an AbortController or stored handler reference to ensure only one listener exists at a time.

---

### P2-D — Port initialization reconnection causes duplicate port on every query

**Files**: `extension/sidepanel.js` — override `sendQuery` (line ~2039)  
**Status**: ❌ Not addressed  

**Symptom**: Every `sendQuery` call checks `if (!streamPort) connectStreamingPort()`. If the previous port disconnected, this creates a new one. But the init's first `connectStreamingPort()` at line 252 already opened a port. Multiple ports accumulate across queries because old ports' `onDisconnect` only fires later.

**Root cause**: No dedup or cleanup of old ports before creating new ones.

**Fix**: Disconnect the old port before creating a new one: `if (streamPort) { try { streamPort.disconnect(); } catch {} }` then `connectStreamingPort()`.

---

## 🟢 LOW (P3 — cosmetic, minor, or refactors)

### P3-A — Duplicate `safeText` call in `addSystemMessage`

**Files**: `extension/sidepanel.js` (line 1517)  
**Status**: 🟡 Fixed in working tree (removed duplicate)

---

### P3-B — Dead code: `domActions` computed but never used in STREAM_DONE handler

**Files**: `extension/sidepanel.js` (line ~1761)  
**Status**: ❌ Not addressed  

Line 1761: `const domActions = (msg.actions || []).filter(...)` — this variable is computed but never referenced.

**Fix**: Remove the dead line.

---

### P3-C — `thinkingTimeout` declared but never used

**Files**: `extension/sidepanel.js` (line ~25)  
**Status**: ❌ Not addressed  

`THINKING_TIMEOUT_MS` is defined and `thinkingTimeout` is declared, but neither is used in the streaming path. The override `sendQuery` doesn't set or clear any thinking timeout.

**Fix**: Either implement the timeout or remove the declarations.

---

### P3-D — Missing content-type Accept header alignment between streaming and non-streaming paths

**Files**: `extension/background.js` — `askZo()` sets `Accept: 'application/json'`, `_askZoStreamImpl()` sets `Accept: 'text/event-stream'`  
**Status**: 🟢 Minor — works correctly but inconsistent

Both paths call the same endpoint (`/zo/ask`) but with different `Accept` headers. The API uses the `stream` field in the request body to determine response format, not the `Accept` header. The `Accept` headers are redundant. Consider removing them or aligning.

---

### P3-E — No version schema in conversation storage

**Files**: `extension/sidepanel.js` — `loadConversations()`, `saveConversations()`  
**Status**: ❌ Not addressed  

Conversations are stored with `id`, `title`, `createdAt`, `updatedAt`, `messages` but no `version` field. Future format changes cannot be migrated safely.

---

## 🔧 Fixes Already Applied (Working Tree)

These fixes exist in the uncommitted working tree but should be validated and committed:

| Fix | File | Description |
|-----|------|-------------|
| SSE content extraction chain | `background.js` | Added `parsed.output` and `parsed.message` to content field fallback chain |
| `askZoStream` STREAM_RECONNECT | `background.js` | Moved RECONNECT message into `if (attempt > 1)` block |
| Inactive session STREAM_DONE fallback | `sidepanel.js` | Added fallback that shows response when `streamSession.active` is false |
| Port disconnect cleanup | `sidepanel.js` | Added `streamSession.active = false` + thinking indicator removal in `onDisconnect` |
| Stale thinking indicator removal | `sidepanel.js` | Added stale thinking removal at start of STREAM_DONE handler |
| Options page ReferenceError | `options.js` | Replaced `DEFAULTS.zoApiUrl` with hardcoded URL |
| CREATE_AUTOMATION handler | `background.js` | Fixed handler signature |

## Tests

**140 tests across 13 files — 140 pass, 0 fail**

The test suite does not cover the streaming SSE reconnection flow, sessionId message routing, or the non-streaming fallback empty-output case. These gaps should be addressed in a follow-up ticket.

## Verification Steps

After applying all fixes:
1. Open side panel on any page
2. Type a query and press Enter
3. Observe: Zo's response should appear in the side panel, not "Done."
4. Rapid-fire two queries — both should display correctly without interference
5. Open Options page, click "Test Connection" — should succeed without ReferenceError
6. Check background SW console for no unhandled errors
