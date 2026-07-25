# #26 — Streaming "Done." Root Cause & Stability Audit

**Date:** 2026-07-26
**Severity:** 🔴 Critical
**Labels:** `bug`, `stability`, `streaming`, `regression`

## Summary

Despite multiple prior fixes (tickets #23, #24, #25), the extension still shows "Done." instead of Zo's actual response when the streaming path is used. This ticket documents the remaining root causes found by auditing the current working tree against the execution flow.

---

## 🔴 P0 — Root Causes of "Done." Display

### P0-A — Non-streaming JSON fallback: empty `data.output` silently maps to "Done."

**Files:** `extension/background.js` (`_askZoStreamImpl` ~line 867), `extension/sidepanel.js` (override `sendQuery` ~line 2082)

**Scenario:** Model doesn't support streaming. Zo API returns `Content-Type: application/json` with `{"output": ""}` or `{"output": undefined}`.

**Trace:**
1. Background detects `content-type: application/json`
2. Calls `finishStream(port, data.output || '', resolvedIntent)` ← `data.output || ''` collapses empty string/undefined to `''`
3. `finishStream` receives `''`: `JSON.parse('')` throws → `reasoning = ''`, `actions = []`
4. `fullText = '' || '' || '' = ''`
5. Sidepanel STREAM_DONE gets `fullText: ''`, `reasoning: ''`, `actions: []`
6. `streamSession.msgEl` is null (no STREAM_CHUNK was ever sent)
7. `responseText = ''` → else branch → `msg.actions?.length` is 0 → **"Done."**

**Fix:** In `_askZoStreamImpl`, when the non-streaming JSON response has empty output, send `STREAM_ERROR` with a descriptive message instead of calling `finishStream` with empty text. Add a fallback in `finishStream` to use `JSON.stringify(output)` when output is an object with no recognized fields.

### P0-B — `streamPort.postMessage()` can silently fail and leave input permanently disabled

**Files:** `extension/sidepanel.js` (override `sendQuery` ~line 2035)

**Scenario:** Port is checked (`if (streamPort)`) but is disconnected between the check and the `postMessage()` call. MV3 service workers can terminate between any two operations, making this a real race.

**Trace:**
1. `if (streamPort)` → true (port was just connected or is stale)
2. `streamPort.postMessage({...})` → throws (port disconnected)
3. Unhandled exception propagates → function exits early
4. Input stays disabled forever because `input.disabled = false` is never reached

**Fix:** ✅ Applied. Added try/catch around `streamPort.postMessage()`. On failure, resets port state and falls through to the non-streaming fallback path. (Applied in uncommitted working tree.)

### P0-C — `addMessage('assistant', 'Done.')` hardcoded in 3 places with no content guard

**Files:** `extension/sidepanel.js` (STREAM_DONE handler ~line 1825, override sendQuery ~lines 2082, 2090)

All three locations have a fallback chain like `reasoning || doneResponse || 'Done.'`. If both `reasoning` and `doneResponse` are empty (P0-A scenario), "Done." is the only fallback.

**Trace of empty-output scenarios:**
- Zo API returns `output: ""` or `output: undefined`
- Model times out and API returns no response content
- SSE parser fails to extract content (format mismatch)
- Non-streaming JSON has empty output

**Fix:** Replace bare `'Done.'` with something more informative like `'Zo responded but the output was empty. Check your Zo API configuration or try a different model.'` and log a warning. Additionally, show `safeText(resp)` as last fallback before the generic message.

---

## 🟡 P1 — Quality & Stability Issues

### P1-A — No `sessionId` in response messages

**Files:** `extension/background.js` (`finishStream` ~line 950, `_askZoStreamImpl` ~line 882)

STREAM_CHUNK, STREAM_DONE, and STREAM_ERROR messages from background do not include the `sessionId` that the sidepanel sent in the request. The sidepanel's guard `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;` never filters these because `msg.sessionId` is always undefined.

**Impact:** If two queries are sent in rapid succession, response messages from the first session can be mixed into the second session's UI, causing message ordering corruption, duplicate messages, and input-state confusion.

**Fix:** Include `sessionId` in every STREAM_* response message. Background should store the sessionId from the sidepanel's ASK_ZO request and echo it back.

### P1-B — `handleStreamActions` adds duplicate assistant message for navigation flows

**Files:** `extension/sidepanel.js` (`handleStreamActions` ~line 1887)

When Zo returns a `navigate` action:
1. STREAM_DONE handler updates `streamSession.msgEl` body with the response text
2. `handleStreamActions` adds a NEW message: "📍 Navigating to: {url}"
3. After 2s timeout, `handleStreamActions` adds YET ANOTHER message with `doneResponse`

Result: 2-3 messages for a single user query. The streaming progress message, the navigation indicator, and the delayed done response all compete for UI space.

**Fix:** When `handleStreamActions` processes navigate actions, it should NOT add a new separate message for "📍 Navigating to:...". Instead, update the existing streaming message body to show navigation progress.

### P1-C — `markdownToHtml` can silently throw and crash event handler

**Files:** `extension/sidepanel.js` (used in STREAM_CHUNK ~line 1749, STREAM_DONE ~lines 1809-1810)

`body.innerHTML = markdownToHtml(...)` can throw if `markdownToHtml` receives unexpected input. Since this runs inside a switch-case inside a port message handler, there's no error boundary. An unhandled exception corrupts the message state and can leave the UI frozen.

**Fix:** Wrap the `innerHTML` assignment in `try/catch` and fall back to `textContent = responseText` on failure.

### P1-D — Non-streaming fallback's `handleStreamActions` splits responsibility

**Files:** `extension/sidepanel.js` (override sendQuery ~lines 2082-2092)

The non-streaming fallback calls `handleStreamActions(actions, reasoning)` and then separately displays the done response:
```javascript
if (doneAction && !hasNavigate) {
  addMessage('assistant', doneResponse || reasoning || 'Done.');
}
```

But `handleStreamActions` may ALSO add the done response after the navigate timeout. The non-streaming path has no such timeout, so the done response is added synchronously here. This means navigate actions in the fallback path get only the synchronous addition, not the async one — inconsistent behavior between streaming and non-streaming paths.

---

## 🟡 P2 — Minor Issues

### P2-A — Dead code: `domActions` computed but unused in STREAM_DONE

**File:** `extension/sidepanel.js` (STREAM_DONE handler ~line 1761)

```javascript
const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
```

This variable is computed but never referenced. Remove it or use it for action-timeline population.

### P2-B — `THINKING_TIMEOUT_MS` constant declared but never used in streaming path

**File:** `extension/sidepanel.js` (line 23, 25)

The 60-second thinking timeout is declared but the streaming override `sendQuery` never references it. Long-running Zo queries show "Zo is thinking..." indefinitely.

**Fix:** Add a `setTimeout` in the streaming path that removes the thinking indicator after 60 seconds and shows a timeout message.

### P2-C — `fireAndForget` / `catch` pattern on `chrome.runtime.sendMessage` swallows errors

**File:** `extension/sidepanel.js` (line 1903 in `handleStreamActions`)

```javascript
chrome.runtime.sendMessage({ type: 'NAVIGATE', url: navigateActions[0].url }).catch(() => {});
```

The empty `.catch()` swallows all errors silently. At minimum, log the error with `console.warn`.

### P2-D — No conversation persistence for streaming action-only responses

**File:** `extension/sidepanel.js` (STREAM_DONE handler ~line 1834)

The persistence block only saves when `responseText` is non-empty:
```javascript
if (responseText) {
  conv.messages.push({ role: 'assistant', text: responseText, timestamp: Date.now() });
}
```

If Zo returns actions-only (no text response), the conversation is not saved. After a reload, the user sees an empty conversation despite Zo having responded with actions.

**Fix:** Also persist a summary when actions are present but responseText is empty (e.g., `conv.messages.push({ role: 'assistant', text: '🧩 Executed ' + actions.length + ' actions', ... })`).

---

## 🔧 Fixes Applied (uncommitted working tree)

| Issue | Fix | File |
|-------|-----|------|
| P0-B: port.postMessage can throw | try/catch → fall through to non-streaming fallback | sidepanel.js |
| P0-D: askZoStream sends RECONNECT on first attempt | Moved `STREAM_RECONNECT` inside `if (attempt > 1)` block | background.js (already fixed in working tree) |
| P1-E: SSE content extraction misses `parsed.output` | Added `parsed.output` and `parsed.message` to content chain | background.js (already fixed) |
| P1-F: STREAM_DONE silently drops when !streamSession.active | Fallback path shows response via addMessage + handleStreamActions | sidepanel.js (already fixed) |
| C5: options.js DEFAULTS ReferenceError | Replaced `DEFAULTS.zoApiUrl` with hardcoded URL | options.js (already fixed) |

## Remaining Actions

1. Fix P0-A: Handle empty JSON output in non-streaming fallback
2. Fix P1-A: Add sessionId to STREAM_* response messages
3. Fix P1-B: Prevent duplicate assistant messages in navigation flows
4. Fix P1-C: Error-boundary for markdownToHtml
5. Fix P1-D: Consistent done-response handling across paths
6. Fix P2-A: Remove dead `domActions` computation
7. Fix P2-B: Use THINKING_TIMEOUT_MS in streaming path
8. Fix P2-C: Log errors from fire-and-forget sendMessage calls
9. Fix P2-D: Persist action-only responses
