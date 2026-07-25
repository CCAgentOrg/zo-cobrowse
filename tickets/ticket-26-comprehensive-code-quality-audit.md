# #26 — Comprehensive Code Quality & Stability Audit

**Date:** 2026-07-26
**Severity:** 🔴 Critical (multiple P0/P1 defects remain)
**Labels:** `bug`, `stability`, `quality`, `regression`, `streaming`, `done-response`
**Tests:** 140/140 pass (439 expect) — exists, does not catch runtime regressions

## Summary

Thorough audit of all four extension files (background.js 1401 lines, sidepanel.js 2140 lines, content.js 163 lines, options.js 317 lines) plus supporting files. Findings grouped by severity.

---

## 🔴 P0 — Feature-Breaking Defects

### P0-1: Missing `sessionId` propagation in streaming response messages

**Files:** `extension/background.js`, `extension/sidepanel.js`
**Root cause:** Background sends `STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR` without including `sessionId`, so the session-id guard in `handleStreamMessage()` (`if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;`) is always bypassed.

**Impact:** If a user sends a new query while the previous stream is still delivering, stale response messages from the old session leak into the new session — corrupting message display and conversation state.

**Fix required:** Add `sessionId` to all `port.postMessage()` calls in `_askZoStreamImpl()` and `finishStream()`.

### P0-2: Non-streaming fallback shows "Done." on empty Zo output

**Files:** `extension/sidepanel.js` (override `sendQuery`, streaming STREAM_DONE `else` branch)
**Root cause:** When Zo returns an empty output string or a response structure that doesn't match the expected JSON schema (no `reasoning`, no `actions`), the fallback text chain `reasoning || doneResponse || 'Done.'` resolves to `'Done.'`.

**Impact:** Model responses that don't fit the rigid JSON schema silently fail, showing "Done." with zero diagnostic information.

**Fix required:** When all fallback texts are empty, show a descriptive fallback like `"Zo responded, but the output was empty. Check the Zo API response in the extension's service worker console."` instead of bare `'Done.'`.

### P0-3: `evalInPage()` uses `chrome.debugger` API which detach-leaks under error

**Files:** `extension/background.js` (lines 301-314)
**Root cause:** `evalInPage()` attaches a debugger to the tab then calls `chrome.debugger.sendCommand()`. If the Runtime.evaluate call times out (`withTimeout`), it rejects — the catch block detaches the debugger. BUT: if the timeout fires *after* the debugger command actually completed (race condition), the debugger is detached mid-conversation.

**Impact:** Context capture falls back to content script or `scripting.executeScript`, both of which may not work on extension-restricted pages. User sees "Could not capture page context."

**Fix required:** Track debugger attach state with a Set, detach only in `chrome.debugger.onDetach` or explicit cleanup, not in catch blocks.

### P0-4: Conversation save races background SW termination

**Files:** `extension/sidepanel.js` (`addMessage` function)
**Root cause:** `addMessage()` calls `saveCurrentConversation()` synchronously after every non-system/non-thinking message. If several messages arrive in rapid succession (e.g., initial page load), multiple `chrome.storage.local.set()` calls race — MV3 service worker can terminate between calls, data loss.

**Impact:** Conversations partially saved or lost on SW restart.

**Fix required:** Debounce save operations (100ms coalesce window) and retry on write failure.

---

## 🟡 P1 — High-Severity Defects

### P1-1: `handleStreamActions()` duplicates assistant messages for navigate actions

**Files:** `extension/sidepanel.js` (STREAM_DONE handler + `handleStreamActions`)
**Root cause:** When Zo returns navigate actions, the STREAM_DONE handler updates `streamSession.msgEl` body content with the done response text, then calls `handleStreamActions()` which adds a SEPARATE "📍 Navigating to: ..." message via `addMessage()`. Then a 2-second timeout adds ANOTHER message with the done response. Result: same response shown 3 times.

**Impact:** User sees triplicate messages for every navigation action.

**Fix required:** When navigate actions exist, STREAM_DONE should skip the msgEl body update and let `handleStreamActions` own the display completely. Alternatively, `handleStreamActions` should not add messages when the STREAM_DONE handler already set the content.

### P1-2: `askZo() ` (non-streaming) and `_askZoStreamImpl()` diverge in prompt construction

**Files:** `extension/background.js` (lines 700-760 vs 956-1015)
**Root cause:** Both functions build identical prompts but using different code paths. Any prompt change requires updating two functions in lockstep. Currently they are identical, but the risk of drift is high.

**Impact:** Non-streaming fallback may behave differently from the streaming path (different persona routing, different prompt structure).

**Fix required:** Extract prompt construction into a shared helper function used by both paths.

### P1-3: `getActiveTabContext()` returns stale context from `currentContext` cache

**Files:** `extension/background.js` (`getActiveTabContext`)
**Root cause:** Context capture runs on every sendQuery call, BUT the async refresh finishes AFTER sendQuery already read `currentContext`. The sidepanel override `sendQuery` calls `await refreshPageContext()` at the top, but the streaming path sends the (possibly stale) `currentContext` to the port immediately.

**Impact:** Zo may receive outdated page context — crucial for pages that update dynamically (e.g., after user actions).

**Fix required:** Wait for context refresh to complete before sending the query.

### P1-4: `options.js` loads as plain script but references module-only config

**File:** `extension/options.js` (line 227)
**Root cause:** Options page is loaded as `<script src="options.js">` (not `type="module"`), but code references `DEFAULTS` which doesn't exist in this scope. Uncommitted fix hardcodes the URL but introduces a maintainability issue.

**Impact:** "Test Connection" button silently fails or throws ReferenceError.

**Fix required:** Move shared config to a loadable module or inline the DEFAULTS object.

### P1-5: `STREAM_RECONNECT` shown as "attempt 1 of 3" on first query (cosmetic)

**File:** `extension/background.js` (`askZoStream`)
**Status:** ✅ Fixed in working tree — `STREAM_RECONNECT` now only sent on retries.

---

## 🔵 P2 — Medium Defects

### P2-1: Conversation persistence misses action-only responses

**File:** `extension/sidepanel.js` (STREAM_DONE handler, persist block)
**Root cause:** The persist block only runs when `responseText` is non-empty. If Zo returns actions with no text (e.g., only `[{type: "click", selector: "#btn"}]`), the conversation is never persisted.

**Impact:** After re-opening the extension, the conversation history omits action-only turns.

**Fix required:** Persist a fallback entry when actions exist but text doesn't: `{ role: 'assistant', text: '[Performed ' + n + ' actions]' }`.

### P2-2: No thinking timeout in streaming path

**File:** `extension/sidepanel.js`
**Root cause:** The override `sendQuery` sets up streaming but never installs a timeout. `THINKING_TIMEOUT_MS` is defined but unused in the override path (only used in the pre-override path that's never reached).

**Impact:** If Zo takes longer than 60 seconds, "Zo is thinking..." stays indefinitely. User can't send another query without reloading.

**Fix required:** Install a timeout in the streaming path that calls `cancelStream()` and shows an error.

### P2-3: `markdownToHtml()` can throw and crash the message handler

**File:** `extension/sidepanel.js` (used in STREAM_CHUNK and STREAM_DONE)
**Root cause:** No try/catch around `body.innerHTML = markdownToHtml(responseText)`. If the markdown contains edge cases that cause the regex to throw (catastrophic backtracking), the entire event handler crashes.

**Impact:** One malformed response can permanently break the streaming message display until page reload.

**Fix required:** Wrap all `markdownToHtml()` calls in try/catch with a textContent fallback.

### P2-4: `chrome.debugger` permission detached on `about:blank` / chrome:// pages

**File:** `extension/background.js` (context capture path 1)
**Root cause:** Debugger-based eval fails silently on restricted pages, falls to content script → `scripting.executeScript`. Both fail on `about:blank`, `chrome://extensions`, etc. The error is swallowed.

**Impact:** "Could not capture page context" shown with no indication of the actual issue (page protocol restriction).

**Fix required:** Detect restricted page protocols and show a meaningful user message.

---

## ⚪ P3 — Low / Quality

### P3-1: `addSystemMessage()` calls `safeText()` twice (duplicate call)

**File:** `extension/sidepanel.js`
**Status:** ✅ Fixed in working tree — one duplicate removed.

### P3-2: `const domActions` computed but never used in STREAM_DONE handler

**File:** `extension/sidepanel.js` (STREAM_DONE case)
**Root cause:** Line computes `const domActions = (msg.actions || []).filter(...)` but the variable is never referenced. It's dead code added in the uncommitted fix.

### P3-3: Theme popover adds document click listener on every open (leak)

**File:** `extension/sidepanel.js` (theme popover)
**Root cause:** `showThemePopover()` adds `document.addEventListener('click', closeThemePopoverOutside, true)` on each invocation. The listener is removed on close, but if the same popover is opened multiple times, multiple listeners briefly exist.

### P3-4: No CSS sanitization in `markdownToHtml()` output

**File:** `extension/sidepanel.js` (line ~1270+)
**Root cause:** The markdown renderer uses `escapeHtml()` as the first step, then applies regex transforms that introduce HTML tags. But if a bare `<script>` or `<img onerror>` slips through (edge case in code blocks or raw HTML in response), it could execute.

### P3-5: `addDuckdbResult()` formats data without pagination

**File:** `extension/sidepanel.js`
**Root cause:** Large DuckDB results (>100 rows, >10KB) are rendered as a single HTML block with no truncation. Chrome side panel has limited vertical space and could hang on very large results.

### P3-6: Missing `version` field in conversation storage schema

**File:** `extension/sidepanel.js` (conversation storage)
**Root cause:** No version field in `cobrowse_convos` storage data. Future format changes have no migration path — stored conversations could become unreadable after an update.

---

## 🔧 Fixes Applied This Round

| Fix | Description | File |
|-----|-------------|------|
| **A** | `streamPort.postMessage` wrapped in try/catch — prevents permanently stuck input when port disconnects between the connection check and the postMessage call | `extension/sidepanel.js` |
| **B** | Inactive-stream fallback in STREAM_DONE — shows response even if `streamSession.active` was cleared by port disconnect | `extension/sidepanel.js` (uncommitted) |
| **C** | SSE content extraction broadened — added `parsed.output` and `parsed.message` to extraction chain | `extension/background.js` (uncommitted) |
| **D** | `askZoStream` only sends `STREAM_RECONNECT` on actual retries (not first attempt) | `extension/background.js` (uncommitted) |
| **E** | `DEFAULTS.zoApiUrl` replaced with hardcoded URL in options.js (fixes ReferenceError) | `extension/options.js` (uncommitted) |
| **F** | `CREATE_AUTOMATION` handler signature fixed | `extension/background.js` (uncommitted) |
| **G** | Duplicate `safeText()` call removed from `addSystemMessage()` | `extension/sidepanel.js` (uncommitted) |

---

## Migration Path

1. Apply all uncommitted changes + Fix A (this ticket)
2. Test streaming: one query → wait for full response → send another → rapid queries (3 in 5 seconds)
3. Test non-streaming fallback: force `streamPort = null` via console, send a query
4. Test conversation persistence: send 3 queries, reload sidepanel, verify history intact
5. Test context capture: open on a Gmail/Youtube/complex SPA, send a query, verify Zo receives useful context
6. Run test suite: `bun test` — target 140/140 passing
