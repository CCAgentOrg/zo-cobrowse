# #26 — Comprehensive Code Quality & Stability Review

**Date:** 2026-07-26  
**Severity:** 🔴 Critical (Multiple P0/P1 defects still active)  
**Labels:** `bug`, `stability`, `quality`, `review`  
**Scope:** `background.js`, `sidepanel.js`, `content.js`, `options.js`, `styles.css`

## Summary

Full codebase review after commits 6652a59, 54d7de9, and uncommitted working-tree fixes. The working tree resolves 5 of the most critical defects (SSE parser crash, port disconnect cleanup, STREAM_RECONNECT on first attempt, Options page ReferenceError, CREATE_AUTOMATION handler mismatch). **7 defects remain active**, with 2 directly causing "Done." to appear instead of Zo's response.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-1 — "Done." shown when Zo SSE stream returns empty/undefined content

**Files:** `background.js` → `_askZoStreamImpl()`, `sidepanel.js` → `handleStreamMessage()`

**Symptom:** User sees SSE eventstream in network tab / console, but sidepanel shows "Done." as the final response.

**Root Cause:** The `_askZoStreamImpl` SSE parser accumulates content from `FrontendModelResponse` events into `fullText`. Three possible scenarios produce empty `fullText`:

**Scenario A — Content field mismatch (most likely):** The Zo API's SSE format may use a content field not in the extraction chain. Despite the broadened chain (`parsed.content || parsed.text || parsed.output || parsed.delta?.text || parsed.delta?.content || parsed.response || parsed.message`), if the API responds with only an `End` event containing `data: {}` (empty object), `fullText` stays `""`, `finishStream` gets empty output, and the STREAM_DONE handler shows "Done."

**Scenario B — Non-streaming JSON model (no SSE):** When the configured model doesn't support SSE streaming, the Zo API returns `content-type: application/json` even with `stream: true`. The code correctly handles this by calling `finishStream(port, data.output || '', ...)`. But if `data.output` is `undefined` or `""`, the output is empty and "Done." appears.

**Scenario C — Stream ended without End event:** The SSE loop ends when `reader.read()` returns `done: true`. If the server closes the connection without sending an `End` event, the final `fullText` may be an incomplete accumulation. The fallback `finishStream(port, fullText, resolvedIntent)` is called, but if chunks were still being accumulated, `fullText` may not contain the complete response.

**Fix:**
- In `finishStream`, when `output` is empty `""` AND the `intent` is not `'lite'`, add a fallback message: `"I received your request but couldn't process it. Try again or check the console for errors."`
- Log `console.warn("finishStream received empty output", { intent, hasActions: actions.length > 0 })` for debugging
- In sidepanel's `STREAM_DONE` handler, when `responseText` is empty and actions is empty, show a more informative message than "Done." — include error context

### P0-2 — `streamSession.msgEl` null path hits "Done." fallback for non-streaming JSON responses

**Files:** `sidepanel.js` → `handleStreamMessage()` STREAM_DONE handler (line ~1820)

**Symptom:** When Zo returns a JSON response via the non-streaming path (content-type: application/json), `_askZoStreamImpl` calls `finishStream()` WITHOUT sending any `STREAM_CHUNK` events. In the sidepanel, `streamSession.msgEl` remains `null` because no chunk arrived. The `STREAM_DONE` handler falls into the `else` branch:
```
if (responseText) { addMessage('assistant', responseText); }
else if (msg.actions?.length) { /* handled by handleStreamActions */ }
else { addMessage('assistant', 'Done.'); }
```
If `responseText` and `msg.actions` are both empty → **"Done."**

**Fix:** When `streamSession.msgEl` is null and `responseText` is empty, check if the Zo API response was parsed in `finishStream` but yielded no extractable text. Log a warning showing what `msg.fullText`, `msg.reasoning`, and `msg.actions` contain.

---

## 🟡 HIGH (P1 — stability & data loss)

### P1-1 — No `sessionId` in STREAM_CHUNK/STREAM_DONE/STREAM_ERROR messages

**Files:** `background.js` → `_askZoStreamImpl()` (all port.postMessage calls), `finishStream()`

**Symptom:** The sidepanel sends `sessionId` with ASK_ZO messages, but background never includes it in response messages. The sidepanel's `handleStreamMessage` guard:
```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```
never filters response messages because `msg.sessionId` is always `undefined` in STREAM_* messages.

**Impact:** If the user sends a second query while the first is still streaming:
1. Session 1's STREAM_CHUNK events continue to update the UI (wrong session)
2. Session 1's STREAM_DONE may set `streamSession.active = false`, killing session 2
3. Responses from both sessions get interleaved

**Fix:** Pass `sessionId` from `msg` to all `port.postMessage({type: 'STREAM_*', ...})` calls, either through `finishStream` or by wrapping each call.

### P1-2 — Conversation persistence drops action-only responses

**File:** `sidepanel.js` → `handleStreamMessage()` STREAM_DONE handler

**Symptom:** When Zo returns a response with only actions (no text/fullText), the conversation persistence block:
```javascript
if (responseText) {
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', text: responseText, ... });
  }
}
```
Only saves if `responseText` is truthy. Pure action responses (e.g., `[{type: "click", selector: "#btn"}]`) are never persisted.

**Fix:** Always save a message to conversation when STREAM_DONE is received, using a fallback text like `"Executed ${actions.length} action(s)"` when `responseText` is empty.

### P1-3 — MV3 service worker timeout kills streaming mid-response

**File:** `background.js` → `_askZoStreamImpl()`

**Symptom:** Chrome terminates the background service worker after 30 seconds idle or 5 minutes active. If a streaming request takes longer than the SW lifetime, the SW terminates, port disconnects, and:
1. The fetch continues in the terminated worker (undefined behavior)
2. The sidepanel's port disconnect handler triggers
3. Even with the uncommitted `!streamSession.active` fallback, the response may arrive after the SW is gone

**Fix:** Use `chrome.runtime.connect` keepalive or implement SW wake detection. Consider splitting long streams into multiple `sendMessage` calls instead of a single port connection. Add a heartbeat interval in the SSE reader while waiting for chunks.

### P1-4 — Stylesheets for manual theme switch (`[data-theme="light"]`) missing dark-background elements

**File:** `extension/styles.css`

**Symptom:** When user manually switches to light theme (not following system preference), certain elements (e.g., code blocks, input fields, action cards) may retain dark styling because the CSS overrides only cover `prefers-color-scheme`, not `[data-theme="light"]`.

**Fix:** Duplicate all `@media (prefers-color-scheme: dark/light)` rules with explicit `[data-theme="dark"]` / `[data-theme="light"]` selectors.

---

## 🟢 MEDIUM (P2 — quality & UX)

### P2-1 — `domActions` declared but unused in STREAM_DONE handler

**File:** `sidepanel.js` → `handleStreamMessage()` STREAM_DONE (line ~1760)

The variable `domActions` is computed:
```javascript
const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
```
...but never used anywhere in the handler. This is dead code. Either remove it or use it to skip redundant work in `handleStreamActions`.

### P2-2 — `addMessage` adds duplicate assistant message for navigate+done responses

**File:** `sidepanel.js` → `handleStreamActions()` and `handleStreamMessage()` STREAM_DONE

When Zo returns `[{type: "navigate", url: "..."}, {type: "done", response: "Done!"}]`:
1. `STREAM_DONE` handler updates `streamSession.msgEl` body with `responseText`
2. `handleStreamActions` adds a SECOND message via `setTimeout`:
   ```javascript
   setTimeout(async () => {
     await refreshPageContext();
     if (doneResponse) addMessage('assistant', doneResponse);
   }, 2000);
   ```
3. The `STREAM_DONE` handler also persists `responseText` to conversation
4. After 2 seconds, the setTimeout fires and ADDS ANOTHER message to conversation

**Impact:** Duplicate messages in both UI and persisted conversation history.

**Fix:** In `handleStreamActions`, check if the action has already been rendered by the streaming path before adding a second message.

### P2-3 — `markdownToHtml` throws on malformed input in STREAM_CHUNK

**File:** `sidepanel.js` → `handleStreamMessage()` STREAM_CHUNK

```javascript
body.innerHTML = markdownToHtml(safeText(msg.text));
```

`markdownToHtml` uses `escapeHtml`, `String.replace`, and DOM string concatenation. None of these are wrapped in try/catch. If `safeText(msg.text)` contains input that causes a Regex match failure or a ReDoS, the entire SSE event handler crashes.

**Fix:** Wrap the `body.innerHTML` assignment in try/catch.

### P2-4 — Options page still uses hardcoded API URL in three places

**File:** `extension/options.js` (lines 227, 272, 299)

The uncommitted change replaced `DEFAULTS.zoApiUrl` with `'https://api.zo.computer/zo/ask'` which is correct. But `options.js` still references hardcoded URLs in two additional places:
- The test connection result text displays the hardcoded URL instead of reading from config
- The form load reads from `config.zoApiUrl` which IS correct, but the save handler writes the raw value from the input field

**Fix:** All API URL references should go through the `config.zoApiUrl` value from storage.

### P2-5 — `getActiveTabContext()` has no grace period for newly loaded pages

**File:** `background.js` → `getActiveTabContext()`

When navigating to a new page, the content script may not be injected yet (`document_idle` trigger). The function tries 3 paths:
1. Debugger eval — may fail if debugger not available
2. Content script message — fails because content script not injected
3. `scripting.executeScript` — may fail if tab is still loading

All three can fail silently, returning `context = { error: '...' }`. The sidepanel then sends empty context to Zo.

**Fix:** Add a retry mechanism (3 attempts, 500ms delay) in `getActiveTabContext()` or the wrapping `refreshPageContext()` to wait for the content script to be injected.

---

## 📋 Summary of All Issues

| ID | Severity | Component | Status | Summary |
|----|----------|-----------|--------|---------|
| P0-1 | 🔴 Critical | SSE stream | ❌ Active | Empty output produces "Done." |
| P0-2 | 🔴 Critical | Non-streaming fallback | ❌ Active | msgEl null path shows "Done." |
| P1-1 | 🟡 High | Session management | ❌ Active | No sessionId in response messages |
| P1-2 | 🟡 High | Data persistence | ❌ Active | Action-only responses not saved |
| P1-3 | 🟡 High | Stability | ❌ Active | SW timeout kills streaming |
| P1-4 | 🟡 High | Styling | ❌ Active | Theme overrides incomplete |
| P2-1 | 🟢 Medium | Dead code | ❌ Active | Unused domActions variable |
| P2-2 | 🟢 Medium | Duplicate messages | ❌ Active | Duplicate added via setTimeout |
| P2-3 | 🟢 Medium | Error handling | ❌ Active | markdownToHtml can crash handler |
| P2-4 | 🟢 Medium | Config | ❌ Active | Options page URL hardcoding |
| P2-5 | 🟢 Medium | UX | ❌ Active | No grace period for new page context |
