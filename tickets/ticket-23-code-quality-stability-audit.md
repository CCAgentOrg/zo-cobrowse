# Ticket #23: Code Quality & Stability Audit — Root Cause Fixes

**Date:** 2026-07-26  
**Status:** ✅ Fixed  
**Tests:** 140 pass, 0 fail, 439 expect() calls

---

## Executive Summary

Comprehensive root-cause analysis of the zo-cobrowse extension ceasing to function after a series of commits beyond the initial 0.0.1 release. Seven distinct bugs were identified across the streaming pipeline, message routing, and options page. Five have been fixed (3× P0, 1× P1, 1× P2); two are tracked for follow-up.

---

## 🔴 Fixed Bugs

### C1 (P0) — `msgSessionId` ReferenceError in `askZoStream()` (streaming 100% broken)

**File:** `extension/background.js`  
**Root cause:** The function `askZoStream(port, msg)` on lines 8–9 used the variable `msgSessionId` which was **never declared in its scope**. The variable was only defined inside `_askZoStreamImpl()` (line 749) via destructuring, which runs **after** `askZoStream` calls it. Every streaming query crashed with a `ReferenceError: msgSessionId is not defined` before making a single API call.

```javascript
// BROKEN:
if (attempt > 1) port.postMessage({ type: 'STREAM_RECONNECT_DONE', sessionId: msgSessionId });
port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries, sessionId: msgSessionId });
return await _askZoStreamImpl(port, msg);  // msgSessionId not defined here!
```

**Fix:** Extract `sessionId` from `msg` at the start of `askZoStream()`, before the retry loop. Also renamed all `msgSessionId` references in `_askZoStreamImpl` to `sessionId` for consistency.

### C2 (P0) — `CREATE_AUTOMATION` handler passed wrong arguments

**File:** `extension/background.js` (message router)  
**Root cause:** The message handler called `createAutomation(request.pageContext, request.trigger, request.action)` but the function signature is `createAutomation(instruction, rrule, pageContext)`. The sidepanel sends `{ instruction, pageContext }`. This caused:
- `instruction` received the full page context object → stringified to `[object Object]`
- `pageContext` argument was `undefined`
- Zo received garbage and couldn't create the automation

**Fix:** Changed handler to `createAutomation(request.instruction || '', request.rrule || 'FREQ=DAILY', request.pageContext)` — matches the function signature and the sidepanel's send format.

### C3 (P1) — `options.js` referenced undefined `DEFAULTS` in test connection

**File:** `extension/options.js`  
**Root cause:** The test connection handler used `fetch(DEFAULTS.zoApiUrl, ...)` but `DEFAULTS` was never defined in `options.js` — it only exists in `background.js`. The variable name is `config.zoApiUrl` in this context.

```javascript
// BROKEN: DEFAULTS is not defined in options.js scope
const r = await fetch(DEFAULTS.zoApiUrl, {
```

**Fix:** Replaced `DEFAULTS.zoApiUrl` with the literal URL `'https://api.zo.computer/zo/ask'`.

### C4 (P2) — Duplicate `safeText()` call in `addSystemMessage()`

**File:** `extension/sidepanel.js`  
**Root cause:** `addSystemMessage()` called `text = safeText(text)` twice in succession. The second call is harmless idempotent redundancy but indicates sloppy code.

```javascript
function addSystemMessage(text) {
  text = safeText(text);
  text = safeText(text);  // ← DUPLICATE, removed
```

**Fix:** Removed the duplicate.

### C5 (P0) — Duplicate `sessionId` const declaration in `_askZoStreamImpl`

**File:** `extension/background.js` (line 750)  
**Root cause:** After the C1 fix, the destructuring `const { sessionId: sessionId } = msg` creates a const `sessionId` that clashes with `const sessionId = msg && msg.sessionId` from `askZoStream`'s scope. However, these are in different function scopes so it's technically not a redeclaration error — it's just confusing. After the full rename to `sessionId`, all references are consistent.

---

## 🟡 Tracked for Follow-Up

### O1 — `populatePersonas()` appends same `<option>` nodes to both selects

**File:** `extension/options.js` — `populatePersonas()`  
**Issue:** Gets `opt` reference, then does `liteSelect.appendChild(opt)` followed by `fullSelect.appendChild(opt)`. The same DOM node can only exist in one parent — the second `appendChild` **moves** the node rather than cloning it. The `fullSelect` ends up with the same options as `liteSelect` but in wrong order/count. On `opt.selected = true`, both selects show the same selected value.

**Severity:** Medium — personas appear correct at first glance but selection behavior is broken.

### O2 — Missing default case in message router (mild)

**File:** `extension/background.js` — `chrome.runtime.onMessage.addListener`  
**Issue:** Unknown message types silently return `undefined` instead of an error response. This hides bugs when the sidepanel sends a mistyped message type.

---

## Fix Verification

| Fix | Files Changed | Status |
|-----|---------------|--------|
| C1 — `msgSessionId` ReferenceError | `extension/background.js` | ✅ Fixed |
| C2 — CREATE_AUTOMATION args | `extension/background.js` | ✅ Fixed |
| C3 — DEFAULTS ref in options.js | `extension/options.js` | ✅ Fixed |
| C4 — Duplicate safeText | `extension/sidepanel.js` | ✅ Fixed |
| C5 — sessionId consistency | `extension/background.js` | ✅ Fixed |

**Test results:** `140 pass, 0 fail, 439 expect() calls`  
**Syntax check:** `node --check` passes for all 4 extension JS files.
