# #26 — Comprehensive Stability & Code Quality Audit

**Date:** 2026-07-26
**Severity**: 🔴 Critical (extension shows "Done." despite successful API responses)
**Status**: **Open** — uncommitted fixes exist in working tree but not yet committed
**Labels**: `bug`, `stability`, `quality`, `streaming`, `done-fix`

---

## 🔴 SUMMARY

After reviewing the full codebase (background.js 1401 lines, sidepanel.js 2109 lines, content.js, options.js, manifest.json), the "Done." display bug is caused by **interacting race conditions in the streaming path** plus **empty-output fallback cascades**. The working tree has uncommitted fixes for most P0 items, but **3 critical defects remain unfixed** that directly cause the "Done." symptom.

---

## 🔴 P0 — DIRECTLY CAUSES "Done." INSTEAD OF ACTUAL RESPONSE

### P0-A — SSE content extraction misses Zo API fields

| File | Lines | Status |
|------|-------|--------|
| `background.js` | 887-900 | **❌ Unfixed in HEAD, ✅ fixed in working tree** |

The SSE content extraction chain only checked `parsed.content`, `parsed.text`, `parsed.delta?.text`, `parsed.delta?.content`, `parsed.response`. If the Zo API sends content in `parsed.output` (which the End event handler already expects), chunks with content in this field are silently skipped, producing empty `fullText`.

**Working tree fix** (not yet committed): Added `parsed.output`, `parsed.message` to the fallback chain.

**Verification needed:** Test with actual Zo API streaming output to confirm fields match.

---

### P0-B — `streamSession.active` check drops STREAM_DONE on port disconnect

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` | 1763-1775 | **❌ Unfixed in HEAD, ✅ fixed in working tree** |

When the background service worker terminates (MV3 30s idle timeout), the streaming port disconnects. The `onDisconnect` handler sets `streamSession.active = false`. When the SW wakes and the SSE stream finishes, `STREAM_DONE` arrives but `if (!streamSession.active) return;` silently drops it.

**Working tree fix**: Added fallback display when inactive — shows `msg.fullText` or `msg.reasoning`, calls `handleStreamActions` for any actions, re-enables input.

---

### P0-C — "Done." fallback cascade when responseText is empty

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` | 1804-1810 | **❌ Still unfixed** |

In `STREAM_DONE` handler, when `streamSession.msgEl` is null (no STREAM_CHUNK received) and `responseText` is empty and `msg.actions?.length` is falsy, it falls through to:
```javascript
addMessage('assistant', 'Done.');
```

This happens when:
1. Model returns non-streaming JSON (detected via `content-type: application/json`)
2. `data.output` is empty/undefined
3. `finishStream` receives empty output → produces empty `msg.fullText`, `msg.reasoning`, and `msg.actions`

**Fix needed:** Add comprehensive fallback before showing "Done." — try `streamSession.fullText`, `msg.reasoning`, or show a meaningful error message.

---

## 🟡 P1 — EXTENSION BREAKS UNDER SPECIFIC CONDITIONS

### P1-A — Missing `sessionId` in response messages

| File | Lines | Status |
|------|-------|--------|
| `background.js` (finishStream) | 940-950 | **❌ Unfixed** |
| `sidepanel.js` (handleStreamMessage) | 1737 | **❌ Unfixed** |

Background sends `STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR` WITHOUT a `sessionId` field. The sidepanel's stale-message guard requires `msg.sessionId` and only filters messages that carry it:

```javascript
// sidepanel.js line 1737
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

Since response messages never carry `sessionId`, the guard never triggers. **Stale responses from previous sessions leak into new sessions**, causing:
- Mixed-up response text
- Premature `streamSession.active = false` (from old STREAM_DONE)
- Input stuck in disabled state

**Fix:** Include `sessionId` from the `msg` argument in all responses sent by `finishStream` and `_askZoStreamImpl`.

---

### P1-B — No error handling for `streamPort.postMessage`

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` | 2030 | **❌ Unfixed** |

```javascript
streamPort.postMessage({
  sessionId: thisSessionId,
  type: 'ASK_ZO',
  ...
});
return;  // <-- returns immediately regardless of send success
```

If the port disconnected between the `if (streamPort)` check and the `postMessage` call, the call throws an unhandled exception. `input.disabled` is never reset → UI is permanently stuck.

**Fix:** Wrap in try/catch, fall back to `chrome.runtime.sendMessage` on failure.

---

### P1-C — Background SW terminates during long streaming responses

| File | Status |
|------|--------|
| MV3 architectural limit | **❌ Requires architectural fix** |

MV3 service workers have a 5-minute max event lifetime. Streaming responses longer than 5 minutes cause SW termination → port disconnection → client shows "Done." even though Zo is still computing.

**Fix options:**
1. Use `chrome.storage.session` for interim checkpoints
2. Implement `setKeepAlive()` or register a no-op alarm to extend SW life
3. Fall back to non-streaming for models with slow responses

---

## 🟡 P2 — QUALITY & MAINTAINABILITY

### P2-A — `handleStreamActions` adds duplicate assistant messages

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` (STREAM_DONE + handleStreamActions) | 1835-1845, 1875-1905 | **❌ Unfixed** |

When STREAM_DONE contains actions, BOTH the STREAM_DONE handler body AND `handleStreamActions` may add assistant messages for the same response. The `handleStreamActions` function also lacks duplicate-input guards.

For navigate actions, `handleStreamActions` shows "📍 Navigating to: ..." AND has a `setTimeout` that adds the `doneResponse` AFTER STREAM_DONE already added it.

---

### P2-B — Action-only responses not persisted to conversation

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` (STREAM_DONE handler) | 1816-1826 | **❌ Unfixed** |

```javascript
// Persist to conversation
if (responseText) {
  // save...
}
```

If the response has no text (only actions like click, fill, extract), `responseText` is empty and the conversation is NOT saved. This means action-only exchanges are lost on panel reopen.

---

### P2-C — `markdownToHtml` can throw and crash event handler

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` (STREAM_CHUNK, STREAM_DONE) | 1745, 1798 | **❌ Unfixed** |

```javascript
body.innerHTML = markdownToHtml(safeText(msg.text));
```

If `markdownToHtml` throws (e.g., recursion via malicious content), the entire SSE event handler crashes. No error message is shown, no input is re-enabled.

---

### P2-D — `addSystemMessage` still uses innerHTML with unsanitized input

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` | 1518 | **❌ Unfixed** |

```javascript
function addSystemMessage(text) {
  text = safeText(text);
  msgsEl.innerHTML += `<div class="msg msg-system"><div class="msg-body">${text}</div></div>`;
}
```

`safeText` converts objects to JSON strings, but `innerHTML +=` with a user/module-controlled string is an XSS vector. Should use DOM creation methods instead.

---

### P2-E — CSS theme popover memory leak

| File | Lines | Status |
|------|-------|--------|
| `sidepanel.js` (showThemePopover) | ~100 | **❌ Unfixed** |

Each call to `showThemePopover` creates a new popover element with event listeners. The `closeThemePopoverOutside` listener is not properly cleaned up, leading to listener accumulation.

---

### P2-F — Variable shadowing in `refreshPageContext`

The sidepanel's `refreshPageContext` uses `var` for the `captureExpr` variable inside a `try` block (line 402). If path 2/3 also use `var` with the same name, it leads to confusing scope behavior.

---

## 🔧 FIXES APPLIED (uncommitted in working tree)

These fixes are in the working tree but NOT yet committed to `main`:

| Fix | File | Description |
|-----|------|-------------|
| ✅ SSE extraction | `background.js:890` | Added `parsed.output`, `parsed.message` to content chain |
| ✅ STREAM_DONE fallback | `sidepanel.js:1765` | Handles inactive streamSession gracefully |
| ✅ Options DEFAULTS | `options.js:227` | Hardcodes API URL instead of referencing undeclared `DEFAULTS` |
| ✅ CREATE_AUTOMATION | `background.js:233` | Fixed argument order |
| ✅ Port disconnect cleanup | `sidepanel.js:1717` | Removes thinking indicator on port disconnect |
| ✅ Stale thinking removal | `sidepanel.js:1761` | Removes thinking indicator before active check in STREAM_DONE |
| ✅ Duplicate safeText | `sidepanel.js:1517` | Removed duplicate in addSystemMessage |

---

## 📋 VERIFICATION

After fixes are applied, verify:
1. Basic query → Zo responds with content (not "Done.")
2. Streaming response → tokens appear incrementally
3. Quick consecutive queries → no stale response leakage
4. Options page → "Test Connection" works
5. Port disconnect → response still shows via fallback
6. Action execution → no duplicate messages
7. Conversation persistence → all exchanges saved
8. Tests → `bun test` passes 140/140
