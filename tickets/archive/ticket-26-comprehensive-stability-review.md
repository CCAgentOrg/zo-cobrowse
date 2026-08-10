# #26 — Comprehensive Stability & Code Quality Review

**Date:** 2026-07-26
**Status:** Open
**Severity**: 🔴 Critical (multiple P0/P1 defects still actively break the extension)
**Labels**: `bug`, `stability`, `quality`, `regression`, `post-release`

---

## Summary

This review examines the full extension codebase after tickets #23, #24, and #25 applied fixes. Despite those fixes, **several critical defects remain** that explain the "eventstream visible in console but sidepanel shows 'Done.'" symptom and other failures.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-01 — Non-streaming fallback shows "Done." on empty Zo output

**Files**: `extension/sidepanel.js` (lines ~2065–2078, override `sendQuery` fallback path)
**Status**: ❌ Unfixed

**Symptom**: When the streaming port is unavailable, `sendQuery` falls through to `chrome.runtime.sendMessage({type:'ASK_ZO'})`. If Zo's API returns an empty `data.output` (undefined / null / empty string), the response object `resp.output` is falsy, `reasoning` stays `''`, `actions` stays `[]`, and the fallback displays `'Done.'`.

**Root cause**: The non-streaming fallback only handles three output shapes:
- `output` as object: extracts `reasoning` + `actions` 
- `output` as string: tries `JSON.parse`, falls back to treating as reasoning
- Everything else: silently ignored, `reasoning = ''`, `actions = []`

If `output` is `undefined`, `null`, `0`, or any other non-string/non-object, the parsing branches are all skipped.

**Fix**: Add an else branch to handle all other types — convert to string with `String()` or `safeText()`, display as reasoning fallback:

```javascript
const output = resp.output;
let reasoning = '';
let actions = [];

if (typeof output === 'object' && output !== null) {
  reasoning = output.reasoning || '';
  actions = output.actions || [];
} else if (typeof output === 'string') {
  // existing JSON parse + fallback
} else if (output) {
  reasoning = String(output); // non-empty truthy but wrong type
}
```

Also add a generic else clause for the empty case that shows a more descriptive message than "Done." — e.g. `"Zo returned an empty response."` — so the user knows the API responded but had no content.

---

### P0-02 — SSE content extraction fails when model returns single `data: {}` chunk per chunk (not per token)

**Files**: `extension/background.js` — `_askZoStreamImpl()` SSE parser
**Status**: ⚠️ Partially fixed in uncommitted changes, but edge case remains

**Symptom**: Some Zo models may return the full response as a single SSE data event rather than streaming token by token. The `data:` line may contain `{"content":"full response text"}` in one chunk, or the `End` event may carry the complete output in `data: {"output":"..."}`. Both should work with the current parser.

**Remaining edge case**: If the Zo API returns an `event: FrontendModelResponse` with `data: {"content":""}` (empty content) and `data: {"output":"complete text"}` as a separate data line in the same event (rare), the parser may skip the empty content line but not recognize `output` in the second line.

**Fix**: None needed for the common case — the parser robustly handles `content:`, `text:`, `output:`, and `delta.*` formats already.

---

### P0-03 — `STREAM_ERROR` silently skipped when `!streamSession.active`

**Files**: `extension/sidepanel.js` — `handleStreamMessage`, `STREAM_ERROR` case
**Status**: ❌ Unfixed

**Symptom**: `STREAM_ERROR` has `if (!streamSession.active) return;` at the top. If a streaming port disconnects and reconnects between query send and error arrival, `STREAM_ERROR` is silently ignored. The user sees a thinking indicator that never resolves and an input that stays disabled.

**Fix**: Remove the `!streamSession.active` guard from `STREAM_ERROR`, or add a fallback path similar to the `STREAM_DONE` fix.

---

### P0-04 — Options page "Test Connection" still broken

**Files**: `extension/options.js` (line 227)
**Status**: ⚠️ Fixed in uncommitted changes (hardcoded URL, pending commit)

The uncommitted diff replaces `DEFAULTS.zoApiUrl` with `'https://api.zo.computer/zo/ask'`. This works but isn't ideal — if the user changes their API URL in storage, the test connection still hits the default URL. Commit the fix, but also consider reading from `chrome.storage.sync` instead.

---

## 🟡 HIGH (P1 — features degraded)

### P1-01 — `streamPort.postMessage()` has no try/catch — port can die between check and send

**Files**: `extension/sidepanel.js` — override `sendQuery`, streaming path
**Status**: ❌ Unfixed

**Symptom**: Between the `if (streamPort)` check and `streamPort.postMessage({...})`, the port could disconnect (MV3 SW termination, network blip). The `postMessage` throws an unhandled error, the `return` early-exits, and the input stays disabled forever.

**Fix**: Wrap the `postMessage` call in try/catch, and on error fall through to the non-streaming `sendMessage` path:

```javascript
if (streamPort) {
  // ... setup session state ...
  try {
    streamPort.postMessage({...});
    return; // streaming path took over
  } catch {
    // Port died — fall through to non-streaming path
    streamPort = null;
  }
}
// Non-streaming fallback continues below...
```

---

### P1-02 — No `sessionId` in `STREAM_CHUNK` / `STREAM_DONE` / `STREAM_ERROR` messages

**Files**: `extension/background.js` — `_askZoStreamImpl()` and `finishStream()`
**Status**: ❌ Unfixed

**Symptom**: The sidepanel's `handleStreamMessage` has a stale-message guard:
```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```
But NO response messages from background include `sessionId`. This means:
1. Stale responses from previous sessions aren't filtered
2. If the user sends Query B before Query A's STREAM_DONE arrives, both responses compete to update the same UI state

**Fix**: Include `sessionId` from the original `msg` in all streaming responses. Store `msg.sessionId` in a variable at the top of `_askZoStreamImpl`:

```javascript
async function _askZoStreamImpl(port, msg) {
  const sessionId = msg.sessionId; // capture for all outgoing messages
  // ...
  port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId });
  // ...
  finishStream(port, fullText, resolvedIntent, sessionId); // pass through

function finishStream(port, output, intent, sessionId) {
  // ...
  port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId });
}
```

---

### P1-03 — Conversation persistence misses action-only responses

**Files**: `extension/sidepanel.js` — `handleStreamMessage`, `STREAM_DONE`
**Status**: ❌ Unfixed

**Symptom**: The STREAM_DONE handler only persists `responseText` to the conversation if it's non-empty. If Zo returns actions without any response text (e.g., just `{actions: [{type: "click", ...}]}`), the conversation history doesn't record anything for that exchange.

**Fix**: Always persist at least the `msg.reasoning` or a summary of actions when `responseText` is empty:

```javascript
if (responseText) {
  // persist responseText
} else {
  const actionSummary = (msg.actions || []).map(a => `${a.type}${a.selector ? ': ' + a.selector : ''}`).join(', ');
  if (actionSummary) {
    const conv = getActiveConversation();
    if (conv) {
      conv.messages.push({ role: 'assistant', text: `⚡ ${actionSummary}`, timestamp: Date.now() });
      saveCurrentConversation();
    }
  }
}
```

---

### P1-04 — MV3 service worker termination kills in-flight streaming

**Files**: `extension/background.js` — `_askZoStreamImpl()` 
**Status**: ⚠️ Known limitation, partial mitigation exists

**Symptom**: Chrome terminates the background service worker after 30 seconds of inactivity or 5 minutes of event processing. Long-running SSE reads are aborted. The port disconnects, and the sidepanel shows a reconnection banner but can't actually resume the in-flight request.

**Partial fix**: Use `chrome.storage.session` to checkpoint the `conversation_id` after each chunk (already partially done — `zoConversationId` is saved). For very long streams, consider breaking the work into a keepalive pattern.

---

## 🟢 MEDIUM (P2)

### P2-01 — Duplicate `safeText` in `addSystemMessage`

**Files**: `extension/sidepanel.js` (line 1517)
**Status**: ⚠️ Fixed in uncommitted changes (pending commit)

### P2-02 — Markdown-to-HTML may throw, breaking streaming UI

**Files**: `extension/sidepanel.js` — `STREAM_CHUNK` and `STREAM_DONE` handlers
**Status**: ❌ Unfixed

**Symptom**: `body.innerHTML = markdownToHtml(...)` and `body.innerHTML = markdownToHtml(responseText)` are not wrapped in try/catch. If `markdownToHtml` throws (extreme edge case, but possible with certain Unicode/malicious input), the entire `handleStreamMessage` callback crashes, and the streaming UI breaks.

**Fix**: Wrap `body.innerHTML` assignments in try/catch:

```javascript
try {
  body.innerHTML = markdownToHtml(responseText);
} catch (e) {
  body.textContent = responseText; // safe fallback
}
```

---

### P2-03 — Overly-aggressive port reconnection on each query

**Files**: `extension/sidepanel.js` (line ~1955)
**Status**: ⚠️ Tolerable but wasteful

**Symptom**: Every call to `sendQuery` reconnects the streaming port (`if (!streamPort) connectStreamingPort()`). The port should ideally persist for the lifetime of the sidepanel. Reconnecting unnecessarily wastes Chrome's port resources.

**Suggested fix**: Track whether the previous port disconnected due to SW termination (transient) vs. sidepanel close (permanent). Only reconnect on transient failures.

---

### P2-04 — `domActions` declared but never used in `STREAM_DONE`

**Files**: `extension/sidepanel.js` (line ~1761)
**Status**: ⚠️ Uncommitted code has dead variable

```javascript
case 'STREAM_DONE': {
  const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
  // domActions is never read after this
```

**Fix**: Remove the dead assignment.

---

## 🟣 LOW (P3)

### P3-01 — Theme popover memory leak
### P3-02 — No version field in conversation storage
### P3-03 — `CREATE_AUTOMATION` handler signature mismatch
### P3-04 — Content script `fill` action has extraneous parentheses

