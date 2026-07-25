# #26 — Code Quality & Stability Audit (Remaining Defects)

**Date:** 2026-07-26
**Severity**: 🔴 Critical (multiple P0/P1 defects still active)
**Labels**: `bug`, `stability`, `quality`, `audit`, `regression`

## Summary

Comprehensive re-audit of `extension/background.js` (1401 lines), `extension/sidepanel.js` (2140 lines), `extension/content.js` (163 lines), `extension/options.js` (317 lines), and `extension/manifest.json` after tickets #23, #24, #25 fixes. Tests: 140/140 pass.

**New findings:**
- **1 P0 bug** (Non-streaming fallback shows "Done." for empty Zo output)
- **2 P1 bugs** (STREAM_DONE duplicates messages for navigate actions; action persistence misses action-only responses)
- **5 medium issues** (unused DOM var, unhandled postMessage, sticky `actionRunning`, race from missing sessionId in responses, content.js semicolon)
- **1 low issue** (dead var `domActions`)

---

## 🔴 CRITICAL (P0 — features broken)

### P0-A — Non-streaming fallback shows "Done." when Zo returns empty output

**Severity**: 🔴 Critical — users see "Done." instead of any meaningful response
**Files**: `extension/background.js` (`finishStream`), `extension/sidepanel.js` (override `sendQuery`)
**Status**: ❌ **Unfixed**

#### Symptom
When `streamPort.postMessage` fails (port disconnected) and the code falls to the non-streaming fallback, if the Zo API returns empty/undefined `output`, the sidepanel shows "Done."

#### Root Cause
`finishStream()` in background.js (line 922):
```javascript
finishStream(port, data.output || '', resolvedIntent);
```

If `data.output` is empty string or undefined, `finishStream` receives `''`. It tries `JSON.parse('')` which throws, sets `reasoning = ''`, `actions = []`, `fullText = ''`. The STREAM_DONE message has empty fields. The sidepanel falls through to `addMessage('assistant', 'Done.')`.

The sidepanel's `responseText` fallback chain doesn't catch this case: `safeText(doneAction?.response) || safeText(msg.fullText) || safeText(streamSession.fullText) || safeText(msg.reasoning) || ''` — all empty → "Done."

#### Fix
In `finishStream()`, when `output` is empty after parsing, include a fallback text showing what was attempted. In the sidepanel's STREAM_DONE handler, add a fallback that surfaces raw response fields before falling back to "Done."

---

## 🟠 HIGH (P1 — feature degradation)

### P1-A — STREAM_DONE + handleStreamActions duplicate assistant messages for navigate actions

**Severity**: 🟠 High — users see duplicate/cascading messages for navigate responses
**Files**: `extension/sidepanel.js` (STREAM_DONE handler + `handleStreamActions`)
**Status**: ❌ **Unfixed**

#### Symptom
When Zo returns actions with `navigate` + `done`, the sidepanel shows:
1. The streaming message body updated with responseText (from STREAM_DONE)
2. `📍 Navigating to: ...` (from `handleStreamActions`)
3. After 2s timeout: the `doneResponse` as another message

Three messages for one Zo response.

#### Root Cause
STREAM_DONE handler updates `streamSession.msgEl` body with `responseText` (which includes the doneAction response). Then `handleStreamActions()` also adds separate messages for navigate (immediate + setTimeout). The user sees the same content rendered in three places.

#### Fix
`handleStreamActions` should check if the response was already rendered by STREAM_DONE's message body update before adding duplicate navigate/done messages. Or STREAM_DONE should skip the body update when actions include `navigate`, letting `handleStreamActions` handle the display.

### P1-B — Action-only responses not persisted to conversation history

**Severity**: 🟠 High — conversation history can lose assistant responses
**Files**: `extension/sidepanel.js` (STREAM_DONE handler, line ~1825)
**Status**: ❌ **Unfixed**

#### Symptom
When Zo returns actions only (no `done` response text), the actions execute but the conversation isn't saved. Reloading the extension shows no record of the response.

#### Root Cause
The persistence block checks `if (responseText)` before saving. If Zo returns `{actions: [{type: "click", selector: "#btn"}]}` without a `done` action, `responseText` is empty and the assistant message is not persisted.

#### Fix
Always persist the assistant response if `msg.reasoning` or `msg.actions.length > 0` exists, constructing a summary text for action-only responses.

---

## 🟡 MEDIUM

### M1 — `streamPort.postMessage` unhandled error

**Severity**: 🟡 Medium — UI stuck if port disconnects between `if (streamPort)` check and `postMessage`
**Files**: `extension/sidepanel.js` (override `sendQuery`, streaming path)
**Status**: ✅ **Fixed** (wrapped in try/catch, see uncommitted changes)

#### Fix
Wrapped `streamPort.postMessage()` in try-catch. On failure, resets `streamSession.active = false`, `streamPort = null`, and falls through to the non-streaming path. This prevents the UI from being permanently disabled.

### M2 — `actionRunning` flag never reset if `runPendingActions` throws

**Severity**: 🟡 Medium — quick commands and re-queries blocked until extension reload
**Files**: `extension/sidepanel.js` (`runPendingActions`, line ~1145)
**Status**: ❌ **Unfixed**

#### Symptom
If `runPendingActions()` encounters an unhandled error (e.g., `chrome.tabs.query` rejection), `actionRunning` stays `true`, blocking all subsequent queries. The user sees no error and cannot send new queries.

#### Root Cause
The `actionRunning` flag is set to `true` at function start (line ~1149) but the `for` loop is wrapped in try/catch:
```javascript
for (let i = 0; i < pendingActions.length; i++) {
  try { ... } catch (e) {
    updateActionCard(i, 'error', e.message);
  }
}
```
Individual actions are caught, but a structural failure (e.g., `pendingActions = null`) before the loop is not.

#### Fix
Wrap the entire function body in try/finally to reset `actionRunning`:
```javascript
try {
  actionRunning = true;
  runAllBtn.disabled = true;
  // ...rest of function
} catch (e) {
  addMessage('error', `Action execution failed: ${e.message}`);
} finally {
  actionRunning = false;
  runAllBtn.disabled = false;
  skipBtn.disabled = true;
  if (!pendingActions?.length) actionsBar.classList.add('hidden');
}
```

### M3 — Missing `sessionId` in STREAM_CHUNK/STREAM_DONE/STREAM_ERROR messages

**Severity**: 🟡 Medium — stale responses from previous sessions can leak into active sessions
**Files**: `extension/background.js` (`finishStream`, `_askZoStreamImpl`)
**Status**: ❌ **Unfixed**

#### Symptom
If the user sends a new query while a previous streaming response is still arriving, the old `STREAM_CHUNK` and `STREAM_DONE` messages (which have no `sessionId`) pass through the sidepanel's guard `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;` because `msg.sessionId` is `undefined`. The old content contaminates the new session.

#### Root Cause
`finishStream()` and `_askZoStreamImpl()` send STREAM_* messages without including `sessionId`. Only the request (`ASK_ZO`) carries a `sessionId`. The guard only filters messages that explicitly carry a `sessionId`, which none of the response messages do.

#### Fix
Include `sessionId` in all port response messages. Background.js receives `sessionId` from `msg.sessionId` in the `ASK_ZO` request, so it can echo it back.

### M4 — `domActions` variable computed but unused in STREAM_DONE

**Severity**: 🟡 Medium — dead code, suggests incomplete action refactoring
**Files**: `extension/sidepanel.js` (STREAM_DONE handler, line ~1760)
**Status**: ❌ **Unfixed**

#### Finding
```javascript
case 'STREAM_DONE': {
  const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
  ...
```
`domActions` is computed but never referenced again in the handler. All action handling is done by `handleStreamActions()` at line ~1840. This is dead code.

### M5 — Missing semicolon in content.js `fill` action

**Severity**: 🟡 Medium — relies on ASI, works but fragile
**Files**: `extension/content.js` (line ~97)
**Status**: ❌ **Unfixed**

#### Finding
```javascript
case 'fill': {
  const el = (await waitForElement(action.selector)) 
  el.focus();
```
Missing semicolon after the assignment. Works due to Automatic Semicolon Insertion but fragile — a future refactor could break it.

---

## 🔵 LOW

### L1 — Options page "Test Connection" still brittle

**Severity**: 🔵 Low
**Files**: `extension/options.js`
**Status**: ✅ **Fixed** (hardcoded URL replaces DEFAULTS.zoApiUrl)

## Verified Working (fixed in uncommitted tree)

| Issue | File | Fix |
|-------|------|-----|
| SSE parser SyntaxError (duplicate `const data`) | `background.js` | ✅ Replaced with single regex match |
| "Done." fallback for no-reasoning + no-actions | `sidepanel.js` | ✅ Added `doneResponse` fallback before 'Done.' |
| End event missing output field | `background.js` | ✅ Added `else if` for structured data |
| Stream recv on first attempt | `background.js` | ✅ Moved RECONNECT inside `if (attempt > 1)` |
| Port disconnect UI cleanup | `sidepanel.js` | ✅ Added thinking indicator removal |
| Stale thinking in STREAM_DONE | `sidepanel.js` | ✅ Added removal regardless of active state |
| SSE content extraction breadth | `background.js` | ✅ Added `output`, `message` to fallback chain |
| Stream inactive session response drop | `sidepanel.js` | ✅ Added fallback render for inactive sessions |
| Options Test Connection ReferenceError | `options.js` | ✅ Hardcoded URL |
| CREATE_AUTOMATION signature | `background.js` | ✅ Fixed handler signature |

## Test Coverage

**140 tests, 0 failures, 439 expect() calls** — unchanged.

The test suite tests:
- Bang command parsing (11 tests)
- Manifest validation (7 tests)
- Sidepanel UI (20 tests)
- Background logic (14 tests)
- Content script (5 tests)
- Options page (7 tests)
- Message protocol contract (2 tests)
- Backend relay (7 tests)
- HTML structure (8 tests)
- Error handling (8 tests)
- Action execution (20 tests)
- Settings persistence (16 tests)
- Remaining coverage / pattern checks (15 tests)

**Gaps:** No tests verify:
- SSE parsing correctness
- Port message flow (sessionId propagation)
- Conversation persistence edge cases
- `runPendingActions` error recovery
