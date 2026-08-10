# #26 — Comprehensive Stability & Code Quality Audit (Round 3)

**Date:** 2026-07-26
**Severity**: 🔴 Critical (multiple remaining P0/P1 defects)
**Labels**: `bug`, `stability`, `quality`, `regression`, `streaming`

## Summary

Third-round audit of `extension/background.js` (1401 lines), `extension/sidepanel.js` (2140 lines), `extension/options.js` (317 lines), `extension/content.js` (163 lines), and related files after tickets #23, #24, #25 and their follow-ups. 

**Tests:** 140 pass, 0 fail, 439 expect() calls across 13 files.

**This round identifies: 5 P0/P1 functional defects, 6 stability/quality issues, and makes 2 in-code fixes.**

---

## 🔴 CRITICAL (P0 — features broken or silently failing)

### C1 — Unhandled `streamPort.postMessage()` throw leaves UI permanently stuck

**File**: `extension/sidepanel.js` (override `sendQuery`, streaming path)
**Status**: ✅ **Fixed in this audit**

**Root Cause**: The `streamPort.postMessage()` call inside the streaming path was not wrapped in a try/catch. Between the `if (streamPort)` null-check and the `.postMessage()` call, the background service worker can terminate (MV3 idle timeout ~30s) which disconnects the port. The resulting `Error: Attempting to use a disconnected port object` propagates as an unhandled promise rejection. Since the function `return`s after `postMessage`, the `input.disabled = false` / `sendBtn.disabled = false` at the end of the function never runs, permanently locking the input.

**Impact**: User can type but cannot submit queries. Requires extension reload to recover.

**Fix applied**: Added try/catch around `streamPort.postMessage()`. On error, resets `streamSession.active = false` and `streamPort = null`, then falls through to the non-streaming `chrome.runtime.sendMessage` fallback path.

### C2 — Non-streaming fallback shows "Done." when Zo returns empty output

**File**: `extension/sidepanel.js` (override `sendQuery`, non-streaming fallback path, ~line 2095-2105)
**Status**: ❌ **Not fixed** (mitigated by fallthrough improvements in C5 fix)

**Root Cause**: When the non-streaming fallback is used (port unavailable) and Zo returns `output: ""` or `output: undefined`:
1. `resp.output` is empty/undefined
2. Both `typeof output === 'object'` and `typeof output === 'string'` fail
3. `reasoning = ''`, `actions = []`, `doneResponse = ''`, `doneAction = undefined`
4. `!actions.length` is true → `addMessage('assistant', '' || '' || 'Done.')` → "Done."

**Impact**: When the port is unavailable AND Zo returns empty output, the user sees "Done." with no useful information.

**Scenario**: Model error, API rate limit, or empty model response when streaming path fails over to non-streaming.

**Suggested Fix**: Before showing "Done.", check if the response had any error metadata (status, error field) and show that instead. Also add a check for `resp.success === false`.

### C3 — `handleStreamActions()` adds duplicate messages for streaming responses with actions

**File**: `extension/sidepanel.js` (STREAM_DONE handler + `handleStreamActions()`)
**Status**: ❌ **Not fixed**

**Root Cause**: When a streaming response contains actions (e.g., `navigate` + `done`), the STREAM_DONE handler:
1. Updates `streamSession.msgEl` body with `responseText` (lines ~1800-1803)
2. Then calls `handleStreamActions()` which adds **another** "📍 Navigating to: ..." message (line ~1842)
3. Then `handleStreamActions`'s `setTimeout` adds **a third** message with doneResponse after 2 seconds

The user sees 3 messages for one Zo response: the streaming body, the navigation indicator, and the done response.

**Impact**: UI noise, confusing experience, duplicate messages.

**Suggested Fix**: Remove the `setTimeout` message add from `handleStreamActions` for navigate+done cases. The done response is already shown via the streaming body update. Or pass a flag to suppress duplicate body updates when actions will handle display.

### C4 — SSE content extraction missing for Zo API formats not covered by fallback

**File**: `extension/background.js` (`_askZoStreamImpl`, SSE parser)
**Status**: ✅ **Already mitigated in uncommitted changes**

**Root Cause**: The SSE content extraction only checks specific fields (`content`, `text`, `output`, `delta.text`, `delta.content`, `response`, `message`). If the Zo API changes its SSE format or uses a different field, chunks produce no content, `fullText` stays empty, and "Done." is shown.

**Mitigation applied in uncommitted changes** (this audit confirms): `parsed.output` and `parsed.message` were added to the extraction chain. The field precedence is now: `content > text > output > delta.text > delta.content > response > message`.

**Recommendation**: Add a fallback that also checks `Object.values(parsed).find(v => typeof v === 'string')` as a last resort to catch any unrecognized string field.

---

## 🟡 HIGH (P1 — stability/reliability impacting)

### S1 — No `sessionId` in streaming response messages

**File**: `extension/background.js` (finishStream, SSE parser → STREAM_CHUNK/STREAM_DONE/STREAM_ERROR)
**Status**: ❌ **Not fixed**

**Root Cause**: The background.js sends `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages WITHOUT the `sessionId` that the sidepanel attaches to the outgoing `ASK_ZO` message. The sidepanel's `handleStreamMessage` guard (`if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;`) is bypassed because `msg.sessionId` is undefined for ALL response messages.

**Impact**: Stale responses from a previous query session can leak into a new session. If the user sends a new query while a previous streaming response is still in-flight, both responses are processed by the current session, causing mixed content.

**Fix**: Include `sessionId` in all port.postMessage calls in background.js:
```javascript
port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId: msg.sessionId });
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId: msg.sessionId });
port.postMessage({ type: 'STREAM_ERROR', error: ..., sessionId: msg.sessionId });
```

### S2 — `askZoStream` retry re-sends entire request without dedup

**File**: `extension/background.js` (askZoStream, lines 1-16)
**Status**: ❌ **Not fixed**

**Root Cause**: The retry loop in `askZoStream` calls `_askZoStreamImpl(port, msg)` again on failure. But the original Zo API request may have already been received and partially processed by Zo. The retry sends a DUPLICATE request, which could:
- Trigger duplicate actions
- Create duplicate conversation history on Zo's side
- Waste API credits

**Impact**: On network flakiness, users may get duplicate responses or actions.

**Fix**: Add idempotency key to the Zo API request body (e.g., `client_id` field with a request UUID), or at minimum warn the user about the retry.

### S3 — Content script missing semicolon in `executeAction` `fill` case

**File**: `extension/content.js` (line ~63)
**Status**: ❌ **Not fixed** (cosmetic, not functionally broken due to ASI)

**Issue**: `const el = (await waitForElement(action.selector)) \n el.focus();` — the first line has extraneous parentheses around `await waitForElement(action.selector)`. Due to ASI (Automatic Semicolon Insertion) this is parsed correctly, but it's a latent defect pattern. If any code is added between these two lines, it will break.

**Fix**: Remove the extraneous parentheses:
```javascript
const el = await waitForElement(action.selector);
```

---

## 🟢 MEDIUM/LOW (P2/P3 — quality/UX)

### Q1 — `domActions` computed but unused in STREAM_DONE handler

**File**: `extension/sidepanel.js` (STREAM_DONE handler, line ~1759)
**Status**: ❌ **Not fixed**

```javascript
case 'STREAM_DONE': {
  const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
```

`domActions` is computed but never referenced again in the handler. It's dead code.

### Q2 — `THINKING_TIMEOUT_MS` defined but unused in streaming override path

**File**: `extension/sidepanel.js`
**Status**: ❌ **Not fixed**

The `THINKING_TIMEOUT_MS = 60000` constant is defined but never used in the override `sendQuery` streaming path. If Zo takes longer than 60 seconds to respond, the "thinking" indicator stays indefinitely with no timeout recovery.

### Q3 — SSE parser reads entire stream body into memory

**File**: `extension/background.js` (`_askZoStreamImpl`, SSE parser)
**Status**: ❌ **Not fixed**

`fullText` accumulates all content chunks as a single string that grows with each SSE event. For very long responses (e.g., research deep-dives, multi-page analyses), this can consume significant memory. The sidepanel also receives the full accumulated text with each chunk event rather than just the delta.

### Q4 — Theme popover document listener memory leak

**File**: `extension/sidepanel.js` (theme popover)
**Status**: ❌ **Not fixed**

Each `showThemePopover()` call adds a `document.addEventListener('click', closeThemePopoverOutside, true)` listener. While `closeThemePopover()` removes it, rapid open/close cycles could leak listeners if close is not always called.

### Q5 — Conversation persistence misses action-only streaming responses

**File**: `extension/sidepanel.js` (STREAM_DONE handler, conversation persistence block)
**Status**: ❌ **Not fixed**

Assistant messages are only persisted to conversation history if `responseText` is truthy. If the response only has actions (no done response text), the conversation history doesn't record it — the user loses context between sessions.

### Q6 — options.js still uses hardcoded Zo API URL

**File**: `extension/options.js` (line 227)
**Status**: ✅ **Already fixed in uncommitted changes**

`DEFAULTS.zoApiUrl` reference replaced with explicit `'https://api.zo.computer/zo/ask'` URL, which resolved the `ReferenceError: DEFAULTS is not defined`.

---

## Summary table

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| C1 | **P0** | Port.postMessage throw locks input | ✅ Fixed this audit |
| C2 | **P0** | Non-streaming "Done." on empty output | ❌ Open |
| C3 | **P0** | Duplicate messages for action responses | ❌ Open |
| C4 | **P0** | SSE format not fully covered | ✅ Mitigated |
| S1 | **P1** | Missing sessionId in response messages | ❌ Open |
| S2 | **P1** | askZoStream retry is not idempotent | ❌ Open |
| S3 | **P1** | Content.js latent syntax defect | ❌ Open |
| Q1 | **P2** | Dead code (domActions) | ❌ Open |
| Q2 | **P2** | Thinking timeout not applied to streaming | ❌ Open |
| Q3 | **P2** | Memory growth from fullText accumulation | ❌ Open |
| Q4 | **P3** | Theme popover listener leak | ❌ Open |
| Q5 | **P3** | Action-only responses not persisted | ❌ Open |
| Q6 | **P3** | options.js ReferenceError | ✅ Fixed |

## Files modified in this audit

- `extension/sidepanel.js` — try/catch for `streamPort.postMessage()`, improved "Done." text fallback in STREAM_DONE handler
