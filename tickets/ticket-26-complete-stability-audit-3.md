# Ticket #26 — Complete Stability & Code Quality Audit (Round 3)

**Date:** 2026-07-26
**Severity:** 🔴 Critical (multiple remaining P0/P1 blockers)
**Labels**: `bug`, `stability`, `quality`, `regression`, `re-audit`, `critical`

## Summary

Third comprehensive audit of `extension/background.js`, `extension/sidepanel.js`, `extension/content.js`, `extension/options.js`, and `extension/manifest.json`. Previous tickets #23, #24, #25 addressed several critical bugs, but **5 new or residual P0/P1 defects remain** that can cause the extension to show "Done." instead of Zo's actual response or silently fail in other ways.

**Test suite: 140 pass, 0 fail. But tests don't cover SSE parsing, streaming message flow, or the multi-path response rendering.**

---

## 🔴 P0 — Zo API returns empty output, sidepanel shows "Done."

**Files**: `extension/sidepanel.js` (non-streaming fallback), `extension/background.js` (SSE End event), `extension/sidepanel.js` (STREAM_DONE handler)

### Symptoms
- Event stream visible in network tab
- Background SW logs show SSE events arriving
- Sidepanel shows "Zo is thinking..." then "Done."
- No error shown

### Root Cause Chain

The "Done." response propagates through three independent paths, any of which can trigger:

**Path A — Non-streaming fallback (background + sidepanel)**:
If the Zo API returns `output: ""` (empty string), `output: null`, or `output: undefined` (e.g., model returns empty response), both the streaming and non-streaming paths cascade through:
1. `finishStream(port, '', ...)` in background.js receives empty `output`
2. `JSON.parse('')` throws → `reasoning = ''`, `actions = []`
3. `doneAction = undefined`, `fullText = '' || '' || '' = ''`
4. STREAM_DONE msg has empty `fullText`, `reasoning`, `actions`
5. Sidepanel's `responseText = '' || '' || '' || '' = ''`
6. Falls through to `addMessage('assistant', 'Done.')` or the inactive session fallback shows nothing

**Path B — Streaming chunks have no extractable content**:
If the SSE format uses a field not in the extraction chain (e.g., `data.output` appears only in End event but chunk content is in an unhandled field like `parsed.value`):
1. Each chunk yields `rawContent = ''` → nothing appended to `fullText`
2. `fullText` stays `''`
3. Same cascade as Path A

**Path C — Non-streaming fallback in override `sendQuery`**:
When `streamPort` is unavailable and the Zo API returns empty/null/undefined `output`:
1. `typeof output` check fails both `'object'` and `'string'` branches
2. `reasoning = ''`, `actions = []`
3. `doneAction = undefined`, `doneResponse = ''`
4. `addMessage('assistant', '' || '' || 'Done.')`

### Fix
- In the non-streaming fallback, guard against `output === null/undefined` before type checks
- In the STREAM_DONE handler, add a final text-fallback extraction that shows `JSON.stringify(output)` before resorting to "Done."
- In `finishStream`, when all parsing fails and `output` is an empty string, log a warning

---

## 🔴 P0 — `streamPort.postMessage` unhandled throw on stale port

**File**: `extension/sidepanel.js` (override `sendQuery` near lines 2030-2047)

### Symptom
If the port disconnects between the `if (streamPort)` check and the `streamPort.postMessage({...})` call, the error propagates as an unhandled exception. `input.disabled` and `sendBtn.disabled` are never reset — UI becomes permanently stuck.

### Root Cause
```javascript
if (streamPort) {
    streamSession.active = true;
    streamPort.postMessage({  // <-- throws if port disconnected
      sessionId: thisSessionId,
      type: 'ASK_ZO',
      ...
    });
    return;  // <-- never reached if postMessage throws
}
```

### Fix
Wrap in try/catch, fall through to the `chrome.runtime.sendMessage` fallback on failure.

---

## 🔴 P0 — SSE chunk content for "content/" event type

**File**: `extension/background.js` (_askZoStreamImpl, line ~893)

### Symptom
The Zo API may use SSE event type `FrontendModelResponse` for text chunks, but some models return Anthropic-style events with `type: "content_block_delta"` where the text is nested under `parsed.delta?.text`. The current chain extracts this correctly.

However, the chain does NOT check for:
- `parsed.value` (used by some streaming APIs)
- `parsed.data` (raw text data field)
If Zo's API ever changes the field name, content extraction silently fails and "Done." is shown.

### Fix
Add `parsed.value` and `parsed.data` fallbacks to the extraction chain.

---

## 🟡 P1 — No `sessionId` in STREAM_ACK/STREAM_CHUNK/STREAM_DONE/STREAM_ERROR messages

**File**: `extension/background.js` (_askZoStreamImpl, multiple `port.postMessage` calls)

### Symptom
Sidepanel's stale-message guard only works when `msg.sessionId` is present:
```javascript
function handleStreamMessage(msg) {
  if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```
Since response messages (STREAM_CHUNK, STREAM_DONE, STREAM_ERROR) don't include `sessionId`, stale responses from previous sessions can leak into the active session — mixing content, showing wrong actions, or causing double-renders.

### Fix
Include `sessionId` from `msg.sessionId` in all response messages in `_askZoStreamImpl`.

---

## 🟡 P1 — Conversation persistence misses action-only responses

**File**: `extension/sidepanel.js` (STREAM_DONE handler near line 1810)

### Symptom
```javascript
if (responseText) {
    conv.messages.push({ role: 'assistant', text: responseText, timestamp: Date.now() });
```
Only persists the assistant message if `responseText` is non-empty. If Zo returns only actions (no `done` response text, no `reasoning`), the conversation isn't saved. On panel reopen, the interaction is lost.

### Fix
Always persist in the STREAM_DONE handler — use `responseText || JSON.stringify(msg.actions) || '(actions only)'`.

---

## 🟡 P1 — `Thinking timeout` timer never cleared

**File**: `extension/sidepanel.js` (override `sendQuery`, lines ~1982-1984)

### Symptom
`THINKING_TIMEOUT_MS = 60000` is defined but the `thinkingTimeout` variable is declared but never set in the override `sendQuery`. The original function (lines 901-1102) that `/was` overridden had timeout handling, but the override does not use it. A Zo call that takes >60s leaves the "thinking" indicator permanently.

### Fix
Set a timeout in the override's streaming path and clear it in `handleStreamMessage`.

---

## 🟡 P2 — `addMessage('user', query)` called before port check, never cleared on failure

**File**: `extension/sidepanel.js` (override `sendQuery`, line ~1982)

### Symptom
`addMessage('user', query)` is called before the streaming path begins. If the streaming path throws or the port fails, the user message is already committed to UI + storage, but no assistant response follows. The user sees a message with no reply.

### Fix
Add the user message only after confirming the port is working, or provide a retry mechanism on failure.

---

## 🟢 P3 — ESLint-visible issues

1. Line 1518: `text = safeText(text);` — duplicate call (already fixed in working tree)
2. Line 1696: `text = safeText(text);` — duplicate call (already fixed)
3. Non-streaming fallback (lines ~2056-2085): `doneAction`, `hasNavigate`, `doneResponse` computed before the `if (!actions.length)` branch — unnecessary work when actions is empty
4. `domActions` computed at line 1758 but never used (dead code in working tree fix)
5. `string` → `String()` coercion not necessary when `safeText` is already called at entry

---

## 🔍 Additional Observations

### Manifest: `debugger` permission may show banner
The Chrome debugger API attaches to each tab for context capture, which shows the "Chrome is being debugged" banner. This is disconcerting for users. Consider removing Path 1 (debugger eval) and relying solely on Path 2 (content script) + Path 3 (executeScript).

### MV3 Service Worker Lifetime
The SW runs for at most 5 minutes per event. Long streaming responses (>5 min) will be cut off mid-stream with no user-visible error. Consider:
1. Sending `STREAM_RECONNECT` when the port reconnects after SW restart
2. Adding a fallback that calls `chrome.runtime.sendMessage` (which survives SW restart) after the port dies

### `evalInPage` lacks `detachDebugger` on successful completion
After a successful `Runtime.evaluate`, the debugger remains attached. Each subsequent call uses the already-attached debugger, which is fine. But if `detachDebugger` is never called, the debugger stays attached for the tab's lifetime. On page navigation, Chrome may auto-detach. Consider attaching per-session and detaching after.
