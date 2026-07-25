# #26 — SSE Empty Buffer Causes "Done." Display Despite API Response

**Date:** 2026-07-26
**Severity**: 🔴 P0 — Critical: API responds but sidepanel always shows "Done."
**Labels**: `bug`, `streaming`, `sse`, `empty-response`, `done`

## Summary

When the Zo API returns a non-SSE JSON response (single blob) with `Content-Type: text/event-stream` or returns SSE events where the `data:` content doesn't match expected SSE parsing patterns, the SSE parser silently drops all content. The accumulated `fullText` remains empty `''`, and all downstream code paths (both streaming/non-streaming fallback) display "Done." instead of the actual response.

## Root Causes

### C1 — SSE Buffer never processed for non-SSE responses (P0)

**File**: `extension/background.js` → `_askZoStreamImpl()` → SSE parsing loop

The SSE parser splits each chunk by `\n` and pops the last element into a `buffer` for the next iteration. Lines in the array are processed through regex matchers (`^data:\s?`, `^event:`). Non-matching lines (like a bare JSON blob `{"output":"..."}`) are silently skipped.

When the response body is a single JSON object (no `\n`), the entire content ends up in `buffer` (via `lines.pop()`) and the `lines` array is empty. The for-loop processes nothing. After the loop, `buffer` is never checked — content is lost.

**When this triggers:**
- Zo API returns JSON with `Content-Type: text/event-stream` (or no content-type)
- Model doesn't support streaming, API returns non-streaming JSON over SSE connection
- API returns `Content-Type: application/json` but code checks `includes('text/event-stream')` first... wait, it doesn't. The code checks `contentType.includes('application/json')` FIRST and handles it correctly.

Actually — the real scenario is: Zo API returns `Content-Type: text/event-stream` with non-SSE body. The code enters the SSE parser, finds no `data:` or `event:` prefixed lines, accumulates nothing, and `fullText` stays `''`.

**Diagnosis data:**
- `GET /zo/ask` with `stream: true` → Zo responds with JSON body + `Content-Type: text/event-stream`
- SSE parser splits by `\n` → entire JSON is one line → `buffer` captures it → `lines` is empty → nothing processed → `fullText = ''`
- `finishStream(port, '', ...)` → empty reasoning, empty actions → "Done."

**Fix:**
After the SSE while loop, check if `fullText` is empty and try to use `buffer` as the final output:

```javascript
// After while loop ends, before finishStream call:
if (!fullText && buffer && buffer.trim()) {
  const trimmed = buffer.trim();
  if (trimmed !== '' && !trimmed.startsWith(':')) {
    fullText = trimmed;
  }
}
finishStream(port, fullText, resolvedIntent);
```

### C2 — No content-type fallback for non-SSE responses (P1)

**File**: `extension/background.js` → `_askZoStreamImpl()`

The code checks for `contentType.includes('application/json')` to handle non-streaming responses. But if the Zo API returns a JSON response with a different content-type (or no content-type at all), this check fails. The code enters the SSE parser, which can't parse JSON, and content is lost.

**Fix:** Add a broader type check that catches any non-SSE Content-Type:

```javascript
const contentType = response.headers.get('content-type') || '';
if (contentType.includes('application/json') || !contentType.includes('text/event-stream')) {
  // Non-streaming path
}
```

---

## 🔴 CRITICAL (P0 — features broken)

### P0-1 — SSE buffer loses non-SSE JSON responses (C1 above)

**Status**: ❌ Unfixed
**Effort**: 15 min
**Fix location**: `extension/background.js` → after SSE while loop

### P0-2 — Options page `Test Connection` shows generic error

**Status**: ❌ Unfixed in HEAD (fixed in working tree)
**Files**: `extension/options.js` line ~227
**Symptom**: `ReferenceError: DEFAULTS is not defined` → caught by try/catch → shows generic "❌ error"
**Fix**: Replace `DEFAULTS.zoApiUrl` with literal `'https://api.zo.computer/zo/ask'` or import from config module.

---

## 🟡 HIGH (P1 — user-facing issues)

### P1-1 — No `sessionId` in streaming response messages

**Files**: `extension/background.js` (finishStream, STREAM_CHUNK, STREAM_ERROR)
**Symptom**: Stale STREAM_DONE from a previous session can leak into a new session. The sidepanel's `handleStreamMessage` guard (`if (msg.sessionId && ...)`) doesn't filter these because `sessionId` is never set on response messages.
**Fix**: Add `sessionId` from `msg` → `_askZoStreamImpl` params → `finishStream` → port.postMessage({ sessionId: ..., type: 'STREAM_DONE', ... })

### P1-2 — handleStreamActions can leave input disabled

**Files**: `extension/sidepanel.js` → `handleStreamActions()`
**Symptom**: When `handleStreamActions` processes DOM actions (not navigate/done), it calls `runPendingActions()` but doesn't re-enable input if `runPendingActions` fails silently. The STREAM_DONE handler re-enables input only AFTER `handleStreamActions()`, so if actions processing fails, input stays stuck.
**Fix**: Add error boundary in `handleStreamActions` for DOM actions.

### P1-3 — Context capture silent failure on debugger unavailable

**Files**: `extension/background.js` → `getActiveTabContext()`
**Symptom**: If `evalInPage` fails (debugger unavailable on some pages), and content script is also not injected (document_idle race), AND `scripting.executeScript` also fails, the function returns `{ error: "Could not capture context" }`. This error is swallowed by the streaming path (the port listener just sends STREAM_ERROR with a generic "Failed" message).
**Fix**: Surface the actual error from context capture in the error message. Check `currentContext` before sending to Zo API.

### P1-4 — Unbounded fullText growth in SSE handler

**Files**: `extension/background.js` → `_askZoStreamImpl()`
**Symptom**: `fullText` string grows unbounded for long streaming responses. No max length limit. Could OOM the service worker.
**Fix**: Cap `fullText` at ~100KB. Stream content beyond the cap can be truncated with a note.

---

## 🟢 MEDIUM (P2 — quality/stability)

### P2-1 — CREATE_AUTOMATION handler signature mismatch

**Files**: `extension/background.js` → onMessage handler (line ~232)
**Symptom**: Arguments passed to `createAutomation()` in wrong order. The handler sends `(request.pageContext, request.trigger, request.action)` but the function expects `(instruction, rrule, pageContext)`.
**Status**: Fixed in working tree (uncommitted)

### P2-2 — Conversation persistence drops action-only responses

**Files**: `extension/sidepanel.js` → STREAM_DONE handler
**Symptom**: Assistant response only persisted if `responseText` is non-empty. Action-only responses (e.g., `{actions: [{type: "click", selector: "#btn"}]}`) are not saved to conversation history.
**Fix**: Persist a summary of actions when responseText is empty but actions exist.

### P2-3 — addMessage duplicates for non-streaming fallback

**Files**: `extension/sidepanel.js` → `sendQuery()` override
**Symptom**: When Zo returns actions (non-empty), `handleStreamActions` may add an assistant message for navigate actions (via setTimeout with `doneResponse`). Then the calling code in `sendQuery` also adds `addMessage('assistant', doneResponse || ...)`. This creates duplicate done messages for navigate actions in the non-streaming fallback path.
**Fix**: Track whether handleStreamActions already added the done response.

### P2-4 — No TTS auto-play for streaming fallback messages

**Files**: `extension/sidepanel.js` → STREAM_DONE handler
**Symptom**: When `streamSession.msgEl` is null (no streaming chunks), the fallback path uses `addMessage()` which calls `speakText()` for TTS auto-read. But when streaming chunks arrived and the message body is updated via innerHTML, the TTS auto-read is not triggered. Inconsistent with non-streaming behavior.
**Fix**: Call `speakText()` when updating streaming message body if TTS auto-read is enabled.

---

## 🔵 LOW (P3 — edge cases/cosmetic)

### P3-1 — Background.js `let config` uses `var` for captureExpr inside try block

**Files**: `extension/background.js` line ~417
**Issue**: `var captureExpr` inside a `try` block shadows at function scope. Works but inconsistent.
**Fix**: Move declaration outside try block.

### P3-2 — No storage migration for conversation schema changes

**Files**: `extension/sidepanel.js` → `migrateOldFormat()`
**Issue**: Only handles the initial v1→v2 migration from `cobrowse_history` to `cobrowse_convos`. No version field in stored data. Future format changes will silently corrupt stored conversations.
**Fix**: Add version field to conversations, implement migration framework.

### P3-3 — Content-security-policy in manifest allows 'unsafe-inline' in sandbox

**Files**: `extension/manifest.json` → `content_security_policy.sandbox`
**Issue**: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` — eval is allowed in the sandbox. While the sandbox is isolated, this weakens the security posture.
**Note**: Already partially addressed in a previous ticket (B5). The extension_pages CSP is tight. Only sandbox remains permissive.

---

## Applying the Fix

### Fix P0-1 — SSE buffer handling

In `extension/background.js`, after the SSE while loop closes but before `finishStream`, add:

```javascript
// After while (true) loop, before finishStream call:
// Check if buffer contains untagged non-SSE content (e.g. plain JSON without data: prefix)
if (!fullText && buffer) {
  const trimmed = buffer.trim();
  if (trimmed && !trimmed.startsWith(':')) {
    fullText = trimmed;
  }
}
finishStream(port, fullText, resolvedIntent);
```

### Fix P0-2 — Options page DEFAULTS reference

In `extension/options.js`:

```diff
- const r = await fetch(DEFAULTS.zoApiUrl, {
+ const r = await fetch('https://api.zo.computer/zo/ask', {
```
