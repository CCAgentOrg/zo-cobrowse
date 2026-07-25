# Ticket #26 — Comprehensive Code Quality & Stability Review

**Date:** 2026-07-26  
**Scope:** `extension/` (background.js, sidepanel.js, content.js, options.js, manifest.json)  
**Status:** Open

---

## Critical (P0 — features broken)

### P0-01: Non-streaming fallback shows "Done." when Zo returns empty output

**Files:** `extension/sidepanel.js`, `extension/background.js`

The `finishStream()` function (background.js) and the STREAM_DONE handler (sidepanel.js) both lack robust fallback text for Zo API responses that have empty output. When the Zo API returns `{"output":""}` (empty string), the entire chain resolves to `responseText=''` and `actions=[]`, producing "Done." despite a successful API round-trip.

**Root cause chain:**
1. Zo API responds with `{"output":""}` (model returns nothing or errors internally)
2. `_askZoStreamImpl` calls `finishStream(port, '', ...)`
3. `JSON.parse('')` throws → `reasoning = ''`, `actions = []`
4. `msg.fullText = ''`, `msg.reasoning = ''`, `msg.actions = []`
5. Sidepanel shows "Done."

**Fix:** In `finishStream()`, detect empty output and send a meaningful STREAM_DONE message. In sidepanel, replace "Done." with context-aware fallback text.

---

### P0-02: `streamSession.active` guard silently drops streaming responses

**Files:** `extension/sidepanel.js`

The STREAM_DONE handler checks `if (!streamSession.active) return;` before processing the response. If the port disconnects between STREAM_CHUNK and STREAM_DONE (e.g., MV3 service worker terminates mid-stream), `streamSession.active` becomes `false` and the final response is silently dropped. The user sees "Done." only because a fallback path that runs after the switch continues.

**Status:** ✅ Partially fixed in working tree (adds fallback display when `!streamSession.active`, but the "Done." path in the `else` branch can still fire for non-streaming JSON responses).

---

### P0-03: STREAM_DONE doesn't include `sessionId` — stale messages leak across sessions

**Files:** `extension/background.js` (`finishStream`, SSE handler)

Background.js sends `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages WITHOUT `sessionId`. The sidepanel's `handleStreamMessage` guard `if (msg.sessionId && ...)` cannot filter these — `msg.sessionId` is always `undefined`. When a user sends two queries rapidly, responses from session 1 leak into session 2's rendering.

**Fix:** Include the ASK_ZO message's `sessionId` in all response messages from background.js.

---

## High (P1 — functionality impaired)

### P1-01: `handleStreamActions` navigates but doesn't re-enable input for DOM-only actions

**Files:** `extension/sidepanel.js`

When `handleStreamActions` processes DOM actions (click, fill, extract, scroll, wait), it calls `runPendingActions()` which sets `actionRunning = true`. But if all actions complete and there are no errors, input is only re-enabled if `runPendingActions()` explicitly re-enables it. The `actionRunning` check at the start of `sendQuery` prevents double-submission but can leak into a stuck state if `runPendingActions()` has a bug.

**Severity:** Medium — input remains disabled, user must reload the sidepanel.

---

### P1-02: Content script `EXECUTE_ACTION` handler uses `sendResponse` asynchronously

**Files:** `extension/content.js`

```javascript
case 'EXECUTE_ACTION':
  if (request.actions && Array.isArray(request.actions)) {
    Promise.all(request.actions.map(executeAction))
      .then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
  executeAction(request.action)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
```

**Issue:** The single-action path does NOT cast `executeAction` result. If `waitForElement` throws (e.g., timeout), the Promise rejection is caught by `executeAction`'s internal try/catch in `content.js`, which returns `{ ok: false, error: ... }`. But there's also the `waitForElement` in `executeAction` itself that can throw unhandled. In MV3, unhandled promise rejections can crash the content script.

---

### P1-03: Context capture lacks error feedback to user

**Files:** `extension/background.js` (`getActiveTabContext`)

The context capture tries 3 paths (Debugger → content script → executeScript). If all 3 fail (e.g., on a `chrome://` URL or a page that blocks content scripts), the function returns `{ error: err.message }`. But the sidepanel's `refreshPageContext()` doesn't check for this error — it silently stores the error object as `currentContext`, which gets sent to Zo as context.

**Consequence:** Zo receives garbage context and may return "I can't see the page" or empty responses.

---

## Medium (P2 — quality, edge cases)

### P2-01: SSE buffer accumulates unbounded

**Files:** `extension/background.js` (`_askZoStreamImpl`)

The `fullText` variable accumulates ALL SSE content without a length cap. For very long responses (100K+ tokens), this can consume significant memory. With event data structures like `parsed`, the JSON.parse calls can also be expensive.

**Fix:** Cap `fullText` at ~200K characters (roughly 50K tokens); discard trailing content past the cap.

---

### P2-02: Conversation persistence drops action-only responses

**Files:** `extension/sidepanel.js` (STREAM_DONE handler)

```javascript
if (responseText) {
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', text: responseText, ... });
  }
}
```

When Zo returns only actions (no `done` response, no `reasoning`), `responseText` is empty and the conversation is NOT persisted. The user loses all context on sidepanel refresh.

**Fix:** Always persist if there are ANY actions, not just when `responseText` is non-empty.

---

### P2-03: `options.js` hardcodes API URL after fix

**Files:** `extension/options.js`

The uncommitted fix replaces `DEFAULTS.zoApiUrl` with a hardcoded string `'https://api.zo.computer/zo/ask'`. This is a band-aid — if the user configures a custom API URL in the extension settings, the Test Connection button still hits the hardcoded URL.

**Fix:** Read the configured URL from `chrome.storage.sync` before calling the test endpoint.

---

### P2-04: `addMessageDOM` innerHTML injection risk

**Files:** `extension/sidepanel.js`

```javascript
function addMessageDOM(role, text) {
  text = safeText(text);
  ...
  body.innerHTML = markdownToHtml(text);
  ...
}
```

`safeText` calls JSON.stringify on non-string types, which can produce text like `{"reasoning":"...","actions":[...]}`. This text is then passed through `markdownToHtml` which calls `escapeHtml` first, so XSS is prevented. However, JSON.stringify output in the UI is confusing for users.

---

### P2-05: SSE parser doesn't handle comments

**Files:** `extension/background.js` (`_askZoStreamImpl`)

The SSE parser handles `event:` and `data:` lines, but SSE spec allows comment lines starting with `:`. The current code skips them with `if (!trimmed || trimmed.startsWith(':')) continue;`. This is correct behavior per SSE spec.

---

### P2-06: No error when content script is blocked by CSP

**Files:** `extension/content.js`

Some sites block content script injection via `script-src` CSP. Chrome MV3 injects content scripts at `document_idle`, but the `CAPTURE_CONTEXT` message may not reach the content script if CSP blocks it. The fallback to `scripting.executeScript` should handle this, but the error message in the sidepanel is generic.

---

## Low (P3 — cosmetic, edge cases)

### P3-01: Theme popover memory leak

**Files:** `extension/sidepanel.js`

The `closeThemePopoverOutside` listener is added on every theme button click but only cleaned up when the popover is explicitly closed. Rapid clicking can accumulate listeners.

---

### P3-02: `evalInPage` debugger may show Chrome banner

**Files:** `extension/background.js`

Using `chrome.debugger.attach` on every context capture shows "Chrome is being debugged" banner to the user. This is jarring and may confuse non-technical users. Consider making Path 2 (content script) the primary path and falling back to debugger only when necessary.

---

### P3-03: `content.js` — unnecessary double-wrapping of `waitForElement`

The `executeAction` function already wraps `waitForElement` calls. But the `waitForElement` itself handles both immediate match and mutation observer. This is fine but could be optimized.

---

## Existing Fixes Status

| ID | Issue | Working Tree Status | Committed |
|----|-------|-------------------|-----------|
| C1 | SSE parser SyntaxError (duplicate `const data`) | ✅ Fixed | ✅ (HEAD) |
| C2 | "Done." shown instead of actual response | ✅ Fixed | ✅ (HEAD) |
| C3 | End event missing output field | ✅ Fixed | ✅ (HEAD) |
| C4 | Options page `DEFAULTS` ReferenceError | ✅ Fixed (hardcoded URL) | ❌ |
| C5 | Invalid `CREATE_AUTOMATION` handler signature | ✅ Fixed | ❌ |
| C6 | Port disconnect leaves UI stuck | ✅ Fixed | ❌ |
| C7 | STREAM_DONE silently dropped on inactive session | ✅ Fixed | ❌ |
| C8 | Duplicate `safeText` in `addSystemMessage` | ✅ Fixed | ❌ |
| C9 | SSE content extraction broadened (parsed.output) | ✅ Fixed | ❌ |
| — | `askZoStream` sends STREAM_RECONNECT on 1st attempt | ✅ Fixed | ❌ |
| — | Only send STREAM_RECONNECT on retries (attempt>1) | ✅ Fixed | ❌ |
