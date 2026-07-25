# #26 — Streaming Stability & "Done." Response Comprehensive Audit

**Date:** 2026-07-26
**Severity:** 🔴 Critical (multiple P0 bugs cause extension to show "Done." instead of actual response)
**Labels:** `bug`, `stability`, `streaming`, `done-fallback`, `quality`

## Executive Summary

The extension has accumulated significant technical debt across 25 rapid-fix commits. The core streaming loop in `background.js` and the response routing in `sidepanel.js` have been patched multiple times without addressing underlying architectural issues. Despite 140 passing tests, several **runtime P0 defects** still cause the sidepanel to show "Done." instead of Zo's actual response.

---

## 🔴 P0 — Extension shows "Done." instead of actual Zo response

### Root Cause Analysis

The "Done." fallback is hit when **all** of the following are true:
1. `streamSession.msgEl` is null (no STREAM_CHUNK was processed)
2. `responseText` is empty/falsy
3. `msg.actions` is empty or undefined

This happens in these scenarios:

### P0-A: Non-streaming JSON return with empty output

**Files:** `extension/background.js:892` (`finishStream`), `extension/sidepanel.js:1830` (STREAM_DONE fallback)

**Scenario:** Model doesn't support SSE. Zo API returns JSON with `content-type: application/json`. The non-streaming handler at `_askZoStreamImpl` line 868 calls `finishStream(port, data.output || '', resolvedIntent)`. If `data.output` is undefined/null/empty string, `finishStream` receives empty string → `reasoning=''`, `actions=[]` → STREAM_DONE has empty fields → sidepanel shows "Done."

**Fix:**
In `finishStream()` — when both `reasoning` and `actions` are empty, include `safeText(output)` as fallback:
```javascript
const fullText = safeDoneResponse || reasoning || safeText(output) || '[No response content]';
```

### P0-B: SSE End event with `{}` data and no accumulated fullText

**Files:** `extension/background.js:852-862`

**Scenario:** Zo API sends End event with `data: {}` (empty JSON). The check `if (data !== '{}' && ...)` skips parsing. If no earlier `FrontendModelResponse` events added content to `fullText` (because content field was empty or mismatched format), `fullText` stays empty → "Done."

**Current state:** Already mitigated by expanded content extraction chain (`parsed.content || parsed.text || parsed.output || ... || parsed.message`).

### P0-C: Port disconnect drops STREAM_DONE events

**Files:** `extension/sidepanel.js:1765`

**Scenario:** MV3 background SW terminates (30s idle / 5min max) while streaming is active. Port disconnects. `onDisconnect` handler sets `streamSession.active = false`. Original STREAM_DONE handler had `if (!streamSession.active) return;` — silently dropping the response.

**Current state:** Fixed in uncommitted tree — the `!streamSession.active` guard now shows the response via fallback `addMessage` and calls `handleStreamActions` before breaking.

### P0-D: SSE events without event: prefix cause content extraction to run in wrong handler

**Files:** `extension/background.js:883-921`

**Scenario:** Some Zo SSE implementations send data lines without an `event:` prefix at all, or use event names other than `FrontendModelResponse`. The default handler tries `JSON.parse(data)` which may fail for non-JSON data (like `[DONE]`). The catch block handles `[DONE]` but for other text, it appends `safeText(data)` to `fullText` and sends `STREAM_CHUNK`. This is actually correct behavior.

---

## 🟠 P1 — Action Display Duplicates

### P1-A: STREAM_DONE body update duplicates with handleStreamActions message

**Files:** `extension/sidepanel.js:1815-1819`, `extension/sidepanel.js:1878` (`handleStreamActions`)

**Scenario:** When Zo returns `{actions: [{type: "navigate", url: "..."}, {type: "done", response: "Done!"}]}`:

1. `STREAM_DONE` handler updates `streamSession.msgEl` body with `responseText` (the done response)
2. `handleStreamActions` is called, which adds `"📍 Navigating to: ..."` as a NEW message
3. After 2s timeout, `doneResponse` is added as ANOTHER message

Result: Three messages for one response. The user sees the same content in both the streaming update and the separate assistant message.

**Fix:** Set `responseText` to empty when there are actions displayed by `handleStreamActions` OR suppress the body update when actions are present:
```javascript
if (body) {
  if (!msg.actions?.length || (msg.actions.length === 1 && msg.actions[0].type === 'done')) {
    body.innerHTML = markdownToHtml(responseText);
  }
}
```

### P1-B: handleStreamActions adds done response AFTER navigate

In `handleStreamActions` (line 1884-1888), navigate flow triggers a `setTimeout` that calls `addMessage('assistant', doneResponse)` after 2 seconds. This creates TWO assistant messages for the done response: one from `STREAM_DONE` body update + one from timeout.

---

## 🟠 P2 — Code Quality Issues

### P2-A: Duplicate `safeText()` call in `addSystemMessage`

**File:** `extension/sidepanel.js:1517`

Current code (pre-fix):
```javascript
function addSystemMessage(text) {
  text = safeText(text);      // ✓ first call
  text = safeText(text);      // ✗ duplicate — same result, wasted operation
```

**Status:** Fixed in uncommitted tree (removed one line).

### P2-B: `domActions` computed but unused in STREAM_DONE

**File:** `extension/sidepanel.js:1759`

```javascript
case 'STREAM_DONE': {
  const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
  // domActions is never used!
```

**Fix:** Remove the dead variable, or use it to decide whether to show the action bar.

### P2-C: Non-streaming fallback doesn't handle undefined `resp.output`

**File:** `extension/sidepanel.js:2064-2084`

When `resp.output` is `undefined`, the code doesn't enter any branch of the type check:
```javascript
const output = resp.output;  // undefined
if (typeof output === 'object' && output !== null) { ... }
else if (typeof output === 'string') { ... }
// output is undefined — both branches skipped
// reasoning = '', actions = [] → "Done."
```

**Fix:** Add a fallback:
```javascript
const output = resp.output;
if (!output) {
  addMessage('error', 'Zo returned an empty response. Check the Zo API or try a different model.');
  ...
  return;
}
```

### P2-D: Stream responses don't carry sessionId

**File:** `extension/background.js:924-932`

Background sends `STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR` without `sessionId`:
```javascript
port.postMessage({ type: 'STREAM_CHUNK', text: fullText });
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText });
port.postMessage({ type: 'STREAM_ERROR', error: ... });
```

The sidepanel's guard requires `msg.sessionId` to filter stale messages:
```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```
Since `msg.sessionId` is undefined, ALL response messages from ALL sessions are accepted. Rapid consecutive queries can cross-contaminate sessions.

**Fix:** Include `sessionId` in all port response messages. The `ASK_ZO` request already carries `sessionId` from the sidepanel — pass it through `_askZoStreamImpl` and include it in every postMessage.

### P2-E: Conversation persistence misses action-only responses

**File:** `extension/sidepanel.js:1843-1853`

```javascript
if (responseText) {
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', text: responseText });
    ...
  }
}
```

When Zo returns `{actions: [{type: "click", selector: "#btn"}]}` (no text response), the assistant
message is not persisted. The conversation history loses these turns.

**Fix:** Always persist, using `msg.reasoning` or `msg.actions` representation as fallback text:
```javascript
const persistText = responseText || msg.reasoning || JSON.stringify(msg.actions || []);
if (persistText) { ... }
```

### P2-F: MV3 background SW timeout kills long-streaming responses

**File:** `extension/background.js:805-930`

The `_askZoStreamImpl` function runs a long-lived SSE read loop. In MV3:
- SW terminates after 30 seconds idle (not applicable here — stream fetch keeps it alive)
- SW terminates after 5 minutes of total event processing

For very long model responses (>5 min), the SW terminates, the port disconnects, and the streaming response is lost. The `askZoStream` retry mechanism only handles fetch failures, not SW lifetime limits.

**Fix:** Not trivially fixable in MV3. Options:
- Split long responses into multiple smaller requests
- Use `chrome.storage.session` as a temporary buffer for partial results
- Consider a dedicated-offscreen-document approach for long-lived connections

---

## 🟡 P3 — Minor Issues

### P3-A: `streamSession.msgEl` type confusion

**File:** `extension/sidepanel.js:114-117`

Three state variables track streaming state:
```javascript
let zoPort = null;           // declared but unused (should be streamPort?)
let streamSessionId = 0;     // declared but unused (should be streamSession.sessionId?)
let streamActive = false;    // declared but unused (should be streamSession.active?)
```

These are legacy variables that are no longer used (the `streamSession` object replaced them). They should be removed to prevent confusion.

**Fix:** Remove unused `zoPort`, `streamSessionId`, `streamActive` declarations.

### P3-B: Theme popover memory leak

**File:** `extension/sidepanel.js:80-86`

Each theme toggle click adds a new document-level event listener via `closeThemePopoverOutside`. While the listener is later removed in `closeThemePopover`, rapid toggle clicks could accumulate listeners before removal.

### P3-C: CSS `data-theme` attribute uses non-standard values

**File:** `extension/sidepanel.js:38-43`

The `data-theme` attribute can be set to `'system'`, `'forest'`, `'ocean'` — only `'dark'` and `'light'` are standard values. The CSS might not have rules for non-standard values, causing unstyled content.

### P3-D: Options page DEFAULTS crossorigin

**File:** `extension/options.js:227`

ReferenceError fixed by inlining `DEFAULTS.zoApiUrl` as `'https://api.zo.computer/zo/ask'`. A better fix would be to import the shared config, but MV3 plain scripts don't support ES module imports. Use a shared `config.js` as an ES module or inline the URL.

---

## Commits Since Last Audit

| Commit | Description |
|--------|-------------|
| 54d7de9 | Fix SSE parser (duplicate `const data`), add fallback for done action without response, End event `reasoning`/`actions` handling |
| 9aed338 | Fix Content-Type detection, error handling, thinking indicator in STREAM_DONE, fallback text |
| 6652a59 | Fix 4 critical P0 bugs (SSE parser crash, AddSystemMessage safeText, Stream reconnection banner, Done display) |
| 59367b7 | Reconnect streaming port per-query, guard against stale port + undefined sendMessage |
| 09d1fac | Comprehensive safeText() guards |
| af1e94b | Handle Anthropic-format delta objects |
| 7593730 | Guard [object Object] in streaming |
| 4edcbca | Fix Zo SSE event: field |
| 6f95ff9 | Guard addMessage/addSystemMessage/speakText against objects |
| 110834a | Kilo Code stability improvements |

## Uncommitted Working Tree Fixes

The following fixes exist in the working tree but are NOT committed:

1. **`streamSession.active` guard**: When port disconnects between STREAM_CHUNK and STREAM_DONE, the response is shown via fallback `addMessage` instead of being silently dropped
2. **SSE content extraction**: Added `parsed.output` and `parsed.message` to content field chain
3. **`askZoStream` STREAM_RECONNECT**: Only sends on actual retries (attempt > 1), not on first attempt
4. **`streamPort.postMessage` try/catch**: Prevents UI lockup if port disconnects between null-check and postMessage
5. **`addSystemMessage` duplicate safeText**: Fixed
6. **Port disconnect UI cleanup**: Removes "thinking" indicator when port disconnects mid-stream
7. **STREAM_DONE stale thinking indicator**: Removed before active-state guard
8. **CREATE_AUTOMATION handler signature**: Fixed arg order
9. **Options page Test Connection**: Replaced DEFAULTS.zoApiUrl with inline URL

## Recommendation

1. **Commit the working tree fixes** — they address P0-C, P2-A, P2-F, and several P2 issues
2. **Fix P0-A** — non-streaming fallback empty output gracefully
3. **Fix P2-D** — add sessionId to all port response messages
4. **Fix P1-A/1-B** — eliminate duplicate assistant messages for action responses
5. **Fix P2-E** — persist action-only responses to conversation history
6. **Fix P2-C** — handle undefined resp.output in non-streaming fallback
7. **Clean up P3-A** — remove dead state variables
