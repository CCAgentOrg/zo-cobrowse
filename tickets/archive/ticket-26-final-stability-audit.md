# #26 — Final Stability & Code Quality Audit

**Date:** 2026-07-26
**Severity:** 🔴 Critical
**Labels:** `bug`, `stability`, `quality`, `regression`

## Summary

Full tree audit after tickets #23, #24, #25 patches. The uncommitted working tree fixes several P0 issues but **3 blocking bugs remain active** in the committed HEAD, plus **5 quality/stability issues**.

## 🔴 P0 — Features Broken

### P0-A — Port disconnect silently drops streaming responses (HEAD)

**Files:** `extension/sidepanel.js`, `extension/sidepanel.js`
**Status:** ❌ Broken in HEAD, ✅ Fixed in working tree (uncommitted)

When the background service worker terminates (MV3 idle timeout), `streamPort.onDisconnect` fires and sets `streamSession.active = false`. Subsequent `STREAM_DONE` messages are silently dropped at the `if (!streamSession.active) return;` guard.

**Fix applied in working tree:** Inactive STREAM_DONE now shows fallback message instead of returning early.

### P0-B — SSE content extraction misses `output` and `message` fields (HEAD)

**Files:** `extension/background.js`
**Status:** ❌ Broken in HEAD, ✅ Fixed in working tree (uncommitted)

The `FrontendModelResponse` content extraction chain did not include `parsed.output` or `parsed.message`, so certain SSE response formats yield `rawContent = ''`, making `fullText` empty → "Done.".

**Fix applied in working tree:**
```javascript
const rawContent = parsed.content || parsed.text || parsed.output || (parsed.delta?.text) || (parsed.delta?.content) || parsed.response || parsed.message || '';
```

### P0-C — Options page `Test Connection` throws ReferenceError (HEAD)

**File:** `extension/options.js:227`
**Status:** ❌ Broken in HEAD, ✅ Fixed in working tree (uncommitted)

`DEFAULTS.zoApiUrl` is not defined in `options.js` scope (loaded as plain script, not ES module). Clicking "Test Connection" silently fails.

## 🔴 P1 — Major Stability Issues

### P1-A — No `sessionId` in response messages from background

**Files:** `extension/background.js` → `finishStream()`, `_askZoStreamImpl()`
**Status:** ❌ Unfixed

`STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages from the background service worker do not carry the `sessionId`. The sidepanel's stale-message guard `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;` never fires for these messages because `msg.sessionId` is always `undefined`.

**Impact:** If a user sends multiple queries in quick succession, STREAM_DONE from the first session can leak into and overwrite the second session's display.

**Root cause:** `finishStream()` constructs the STREAM_DONE object without including the original `msg.sessionId`. Each `port.postMessage()` call in `_askZoStreamImpl()` similarly omits it.

**Fix:** Thread `sessionId` from the incoming ASK_ZO message through to all response messages.

### P1-B — `handleStreamMessage` STREAM_ERROR ignores inactive sessions

**File:** `extension/sidepanel.js:1822`
**Status:** ❌ Unfixed

```javascript
case 'STREAM_ERROR': {
  if (!streamSession.active) return;  // silently drops errors
```

If the port disconnects and reconnects, errors from the disconnected session are dropped. The user never sees the error.

**Fix:** Remove the `!streamSession.active` guard from STREAM_ERROR, or fall through to showing the error in a fallback path.

### P1-C — STREAM_DONE fallback displays "Done." when actions exist

**File:** `extension/sidepanel.js` - STREAM_DONE handler, `else` branch
**Status:** ❌ Unfixed in both HEAD and working tree

```javascript
} else {
  // No streaming chunks — fallback to addMessage
  if (responseText) {
    addMessage('assistant', responseText);
  } else if (msg.actions?.length) {
    // Response is in actions — will be rendered by handleStreamActions
  } else {
    addMessage('assistant', 'Done.');
  }
}
```

When `streamSession.msgEl` is null AND `responseText` is empty AND `msg.actions` has items, the code falls through to `handleStreamActions` (after the if/else block). But `responseText` was used as the fallback text — if both `responseText` and `msg.actions?.length` are falsy, it shows "Done." even when the model returned a valid response.

**Fix:** Add a more comprehensive fallback chain before showing "Done." — check `msg.reasoning`, `safeText(msg)`, and the raw accumulated `fullText`.

## 🟡 P2 — Quality Issues

### P2-A — Duplicate `safeText` call in `addSystemMessage`

**File:** `extension/sidepanel.js:1517`
**Status:** ✅ Fixed in working tree

Two consecutive `text = safeText(text);` calls — first one's result is immediately overwritten.

### P2-B — Dead variable `domActions` in STREAM_DONE handler

**File:** `extension/sidepanel.js` — STREAM_DONE handler (working tree)
**Status:** ❌ New

`const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');` is computed but never read. Wasteful computation at every STREAM_DONE.

### P2-C — 60-second thinking timeout never used in streaming path

**File:** `extension/sidepanel.js`
**Status:** ❌ Unfixed

`THINKING_TIMEOUT_MS` (60000) is declared but only the original (overridden) `sendQuery` uses it. The streaming `sendQuery` override has no timeout mechanism. If Zo takes >60 seconds, the "thinking" indicator stays indefinitely.

### P2-D — Conversation persistence misses action-only responses

**File:** `extension/sidepanel.js` — STREAM_DONE handler
**Status:** ❌ Unfixed

The assistant message is only persisted to conversation history if `responseText` is truthy. Responses consisting only of actions (e.g., `actions: [{type: "click", ...}]` with no `done` action) are not saved.

### P2-E — `markdownToHtml` exceptions crash the event handler

**File:** `extension/sidepanel.js`
**Status:** ❌ Unfixed

`body.innerHTML = markdownToHtml(safeText(msg.text))` — if `markdownToHtml` throws (e.g., regex ReDoS), it crashes the STREAM_CHUNK/STREAM_DONE handler. No try/catch wraps these calls.

## 🟢 P3 — Minor Issues

### P3-A — Theme popover event listener leak

Each theme popover open adds a new `document.addEventListener('click', closeThemePopoverOutside, true)`. If opened multiple times, listeners accumulate.

### P3-B — No version field in storage schema

`cobrowse_convos` has no `_version` field. A future schema change would corrupt existing stored conversations.

### P3-C — Service worker terminates during long streaming

MV3 limits: 30s idle, 5min event. No keepalive mechanism. Files with `debugger` permission may get longer leases but this is undocumented.

---

## Summary of Recommended Fixes

| ID | Severity | Component | Fix |
|----|----------|-----------|-----|
| P1-A | 🔴 | background.js | Thread `sessionId` through all response messages |
| P1-B | 🔴 | sidepanel.js | Remove `!streamSession.active` guard from STREAM_ERROR |
| P1-C | 🔴 | sidepanel.js | Add comprehensive fallback before "Done." |
| P2-B | 🟡 | sidepanel.js | Remove unused `domActions` variable |
| P2-C | 🟡 | sidepanel.js | Add timeout mechanism to streaming sendQuery |
| P2-D | 🟡 | sidepanel.js | Persist action-only responses |
| P2-E | 🟡 | sidepanel.js | Wrap markdownToHtml in try/catch |
| P3-A | 🟢 | sidepanel.js | Theme popover listener cleanup |
