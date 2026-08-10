# #26 — Comprehensive Code Quality & Stability Re-Audit

**Date:** 2026-07-26
**Severity**: 🔴 Critical — 4 P0 bugs still break the extension
**Labels**: `bug`, `stability`, `quality`, `streaming`, `regression`
**Files audited**: `background.js` (1401 lines), `sidepanel.js` (2109 lines), `content.js` (163 lines), `options.js` (317 lines), `manifest.json`

**Test suite**: 140 pass, 0 fail (439 expect)

---

## 🔴 P0 — Extension shows "Done." instead of actual response

### P0-1: Non-streaming fallback shows "Done." when Zo returns empty output

**Status**: ❌ **Unfixed**
**File**: `sidepanel.js` (lines 2080–2105) — non-streaming fallback inside `sendQuery`
**File**: `background.js` (lines 936–954) — `finishStream()`

When the streaming port is unavailable OR the Zo API returns a non-streaming JSON response with empty output, `addMessage('assistant', reasoning || doneResponse || 'Done.')` shows "Done." because both `reasoning` and `doneResponse` are empty.

**Root cause chain**: Zo model returns empty/partial output → `data.output` is `undefined` or `""` → `output = ""` → `JSON.parse` throws → `reasoning = ""` → `actions = []` → `doneAction` is `undefined` → `doneResponse = ""` → `addMessage('assistant', '' || '' || 'Done.')` = "Done."

**Fix needed**: Show the raw response text before falling back to "Done.":
```javascript
// Before:
addMessage('assistant', reasoning || doneResponse || 'Done.');
// After:
addMessage('assistant', reasoning || doneResponse || safeText(resp.output) || 'Done.');
```

---

### P0-2: STREAM_DONE "Done." fallback in streaming path hits when Zo returns action-only responses

**Status**: ⚠️ **Partially Fixed** (uncommitted)
**File**: `sidepanel.js` (lines 1815–1825) — STREAM_DONE fallback branch

When `streamSession.msgEl` is null (no STREAM_CHUNK received) AND Zo's response is action-only (no doneAction response text, no fullText, no reasoning), the fallback shows "Done." even though actions are about to be executed.

**Current code**:
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

The `msg.actions?.length` check catches the action-only case, but `responseText` may still be empty when `msg.fullText` is a JSON string with `actions` but no `done.response`. Need to show a summary message before executing actions.

---

### P0-3: `sendQuery` override has ambiguous variable name collision with original function declaration

**Status**: ❌ **Unfixed**
**File**: `sidepanel.js` (line 1906)

The original function declaration `async function sendQuery()` at line ~901 is overwritten at line 1906 by `sendQuery = async function()`. Before the override takes effect at parse time, any code that references `sendQuery` uses the original definition. Specifically:

- The `PENDING_ZO_QUERY` message listener at line 259 calls `sendQuery()` after the sidepanel loads
- If the PENDING_ZO_QUERY message arrives BEFORE the override (race at init time), the old non-streaming version runs

**Fix needed**: Remove the original `async function sendQuery()` definition entirely and only define the streaming version. Or rename to a single function.

---

### P0-4: Context capture may silently fail, Zo receives empty page context

**Status**: ❌ **Unfixed**
**File**: `background.js` (lines 388–478)

`getActiveTabContext()` tries 3 fallback paths, all of which can silently fail:
1. Debugger eval — `chrome.debugger` may not attach (permissions, chrome:// pages)
2. Content script — may not be injected yet on new tabs
3. `scripting.executeScript` — needs `activeTab` permission to be active

If all 3 fail, the function returns `{ error: err.message }`, which is passed to Zo. The model then responds with "I can't see the page" — no visible error to the user.

---

## 🟡 P1 — Stability & Reliability Issues

### P1-1: Port disconnect during streaming silently drops response

**Status**: ⚠️ **Partially Fixed** (uncommitted)
**File**: `sidepanel.js` (lines 1763–1775)

When the persistent port disconnects (MV3 service worker terminates), `streamSession.active` is set to `false`. The uncommitted fix adds a fallback that shows the response, but there's no reconnection strategy — once the port disconnects mid-stream, the response can't be delivered.

---

### P1-2: No `sessionId` in streaming response messages

**Status**: ❌ **Unfixed**
**File**: `background.js` (lines 900–950 in `_askZoStreamImpl`)

`STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages don't include `sessionId`. The sidepanel's stale-message guard in `handleStreamMessage` requires `msg.sessionId` to filter messages by session, but the guard is ineffective because `msg.sessionId` is always `undefined`.

This means:
- Rapid queries (user sends new query while streaming) get cross-contaminated responses
- Old STREAM_DONE from session N can arrive during session N+1

**Fix needed**: Thread the `sessionId` from the ASK_ZO message through `_askZoStreamImpl` to all response messages.

---

### P1-3: `handleStreamActions` adds duplicate assistant messages for navigate + done

**Status**: ❌ **Unfixed**
**File**: `sidepanel.js` (lines 1875–1900)

When Zo returns `[{type: "navigate", url: "..."}, {type: "done", response: "Text"}]`:
1. `handleStreamActions` calls `addMessage('assistant', '📍 Navigating to: ...')`
2. Then `setTimeout(2000, ...)` adds `addMessage('assistant', doneResponse)`
3. Separately, STREAM_DONE/MESSAGE handler also adds the response message

This double-adds both the navigation and done messages.

---

### P1-4: Background.js MV3 service worker timeout kills long streams

**Status**: ❌ **Unfixed**
**File**: `background.js` (no keepalive mechanism)

MV3 service workers have a 30s idle timeout and 5min event lifetime. `_askZoStreamImpl` runs a long-held `fetch()` + SSE reader loop. If the model takes >5 minutes, the SW terminates mid-stream. `port.postMessage()` fails silently. The sidepanel never shows the response.

**Fix needed**: Either chunk-long requests, use Extension API keepalive, or implement a port-reconnect strategy.

---

### P1-5: `options.js` "Test Connection" uses undeclared `DEFAULTS`

**Status**: ⚠️ **Partially Fixed** (uncommitted — hardcoded URL)
**File**: `extension/options.js` (line 227)

The uncommitted fix inlines `'https://api.zo.computer/zo/ask'` directly. This fixes the ReferenceError but hardcodes the URL, ignoring user-configured custom API endpoints.

---

## 🟢 P2 — Code Quality & Maintainability

### P2-1: Conversation persistence drops action-only responses
**File**: `sidepanel.js` lines 1828–1842 — only persists when `responseText` is truthy

### P2-2: `markdownToHtml` can throw on unexpected input
**File**: `sidepanel.js` lines ~1250–1400 — regex `replace()` chains can throw

### P2-3: `domActions` computed but unused in STREAM_DONE handler
**File**: `sidepanel.js` line 1759 — `const domActions = ...` variable is never used

### P2-4: Theme popover memory leak
**File**: `sidepanel.js` lines ~100–120 — `document.addEventListener('click', ...)` can accumulate listeners

### P2-5: Context menu memory leaks on installation
**File**: `background.js` — `contextMenus.create()` doesn't call `contextMenus.removeAll()` first, so extension updates can duplicate menu entries

### P2-6: `content.js` misnamed `waitForElement` timeout variable
**File**: `content.js` line 97 — parameter `timeout` shadows outer variable `timeout`

### P2-7: No schema versioning in stored conversations
**File**: `sidepanel.js` — conversations stored in `chrome.storage.local` without a version field

---

## Summary

| Priority | Count | Key Impact |
|----------|-------|------------|
| P0 | 4 | "Done." instead of response, broken features |
| P1 | 5 | Lost responses, stuck UI, silent failures |
| P2 | 7 | Code quality, edge cases, minor bugs |

**Immediate fix priority**: P0-1 (empty output fallback), P1-2 (sessionId threading), P1-3 (duplicate messages)
