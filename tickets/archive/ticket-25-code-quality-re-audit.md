# #25 — Code Quality & Stability Re-audit (Post-Fix Verification)

**Date**: 2026-07-26
**Severity**: 🔴 Critical (multiple remaining blockers)
**Effort**: Medium
**Labels**: `bug`, `stability`, `quality`, `regression`, `re-audit`

## Summary

Re-audit of `extension/background.js` (1473 lines), `extension/sidepanel.js` (2110 lines), `extension/options.js` (317 lines), `extension/content.js` (163 lines), and supporting files after tickets #23 (code quality) and #24 (streaming/done response) were applied. Tests pass at 140/140.

**Findings:**
- **1 new P0 defect** (Options page "Test Connection" throws ReferenceError from undeclared variable)
- **3 remaining unfixed issues from ticket #23** (M2, M5, L2)
- **3 new quality/stability issues** introduced or missed by the recent SSE rewrite
- **1 lingering code quality issue** (duplicate `safeText` call)

---

## 🔴 CRITICAL (blocking — extension broken or silently failing)

### C5 — Options page "Test Connection" throws ReferenceError from undeclared `DEFAULTS`

**File**: `extension/options.js`, line 227
**Severity**: P0 (anyone clicking "Test Connection" gets a silent failure)

```javascript
// options.js line 227
const r = await fetch(DEFAULTS.zoApiUrl, { ... });
```

`options.js` is loaded as a **plain script** (`<script src="options.js"></script>` — no `type="module"`), not a module. The variable `DEFAULTS` is defined in:
- `extension/background.js` (service worker module scope — not accessible from options page)
- `extension/lib/config.js` (ESM module with `export` — not imported by options.js)

There is **no `DEFAULTS` declaration** anywhere in `options.js`. When the user clicks "Test Connection," this line throws an uncaught `ReferenceError: DEFAULTS is not defined`, and the error catch block in the test handler may or may not catch it depending on execution order. The user sees a generic "❌ undefined" error.

**Impact**: Any user who configures an access token and clicks "Test Connection" gets a broken feature. Since settings is the primary onboarding path, this breaks the validation step.

**Root cause**: During the config module extraction (commit `1a9c7e9`), `DEFAULTS` was moved from being inline in background.js to `lib/config.js` as an ESM export. The options page was never updated to import it. The reference `DEFAULTS.zoApiUrl` was left as a dangling reference.

**Fix**: Either (a) inline the default value or (b) add a local fallback constant:

```javascript
// Near top of options.js
const DEFAULT_API_URL = 'https://api.zo.computer/zo/ask';

// In test-connection handler (line 227):
const r = await fetch(DEFAULT_API_URL, { ... });
```

Better yet, read from storage like the rest of the options page does.

---

### C6 — SSE Parser Rewrite Drops Unknown Event Types (uncommitted regression risk)

**File**: `extension/background.js` (working tree — `_askZoStreamImpl`)
**Severity**: P0 potential regression

The uncommitted working tree rewrites the SSE parser from a simple catch-all pattern to an event-type discriminator with `PartStartEvent`, `PartDeltaEvent`, `FrontendModelResponse`, `End`, `completed`, and `Error` handlers. Each supported type has its own `if` block with a `continue` or `return`. Unknown event types fall through to a JSON-parsing fallback at the bottom.

**Problem**: In the committed HEAD code, any `data:` line whose event type was not explicitly recognized was processed by the `FrontendModelResponse` catch-all (which was the default/else clause). In the new code, unknown event types fall through to a fallback that only handles JSON-parsable data with `content`/`text` fields. Non-JSON plain text data from unrecognized event types is silently dropped.

**Impact**: If Zo's API ever sends a new event type (e.g., `AgentRuntimeStreamChunk`, `ToolCallEvent`, `ThinkingEvent`) with plain text content, the streaming path produces no output. The user sees "Zo is thinking..." forever until timeout.

**Fix**: Add an explicit catch-all before the fallback that treats any unrecognized event type the same as `FrontendModelResponse`:

```javascript
// After all specific event type handlers, before the fallback:
if (!currentEventType || currentEventType === 'FrontendModelResponse') {
  // Original FrontendModelResponse handling...
  continue;
}
```

Or keep the simpler committed-HEAD parser which doesn't have this issue.

---

## 🟡 HIGH (functional degradation, data loss risk)

### H4 — Options page hardcodes API base URL in test-connection, model-list, persona-list (ticket #23 M2 — UNFIXED)

**File**: `extension/options.js`, lines 227, 272, 299
**Severity**: High

Three functions hardcode `https://api.zo.computer/` instead of using the user's configured API URL:

1. **Test Connection** (line 227): `fetch(DEFAULTS.zoApiUrl, ...)` — also broken per C5
2. **populateModels** (line 271): `fetch('https://api.zo.computer/models/available', ...)`
3. **populatePersonas** (line 299): `fetch('https://api.zo.computer/personas/available', ...)`

**Impact**: If the user configures a custom API URL in the extension, the options page still:
- Tests connection against the default endpoint
- Lists models from the default endpoint
- Lists personas from the default endpoint

**Fix**: Load `zoApiUrl` from `chrome.storage.sync` before fetching (or read from `chrome.storage.local` for sensitive config), and construct the full URL with the correct path:

```javascript
const apiBase = (await chrome.storage.sync.get('zoApiUrl')).zoApiUrl || 'https://api.zo.computer';
await fetch(`${apiBase}/models/available`, ...);
```

---

### H5 — No throttling for context-menu-triggered queries (ticket #23 M5 — UNFIXED)

**File**: `extension/background.js`, lines 547–583
**Severity**: High

The context menu handler fires `chrome.storage.session.set({ pendingZoQuery: ... })` on every right-click action without deduplication or debouncing. Rapid repeated right-clicks queue multiple `PENDING_ZO_QUERY` messages. The sidepanel's `checkPendingQuery()` polls for these and fires them all concurrently, creating multiple simultaneous Zo API calls.

**Fix**: Add a debounce (~500ms) keyed by `sender.tab.id + contextType`:

```javascript
const contextMenuDebounce = new Map();
function debounceContextMenu(key, fn, ms = 500) {
  clearTimeout(contextMenuDebounce.get(key));
  contextMenuDebounce.set(key, setTimeout(() => { contextMenuDebounce.delete(key); fn(); }, ms));
}
```

---

### H6 — Content script `fill` action has ASI-dependent missing semicolon

**File**: `extension/content.js`, line ~73
**Severity**: High (potential silent breakage)

```javascript
case 'fill': {
    const el = (await waitForElement(action.selector)) 
    el.focus();
```

The `const el` declaration line has no semicolon. The `el.focus()` on the next line begins with `el`, which is a valid continuation of the previous expression. JS ASI inserts a semicolon after `))` at the line break, so this technically works — but it's fragile. If the code is ever minified or wrapped in a different context, ASI may not trigger and `el.focus()` would be parsed as `(expression)el.focus()` — a TypeError.

**Fix**: Add a semicolon:

```javascript
const el = await waitForElement(action.selector);
```

---

### H7 — Debugger attachment leaks across tab navigations

**File**: `extension/background.js`, functions `attachDebugger`, `evalInPage`
**Severity**: High

The `debuggerTabMap` tracks attached debuggers by tab ID. When a page navigates without closing the tab, the debugger session remains attached. `evalInPage()` tries to attach via `attachDebugger()` which returns `true` if `debuggerTabMap` says it's already attached — but Chrome invalidates the debugger session on cross-origin navigation. This causes subsequent `Runtime.evaluate` commands to fail silently.

**Fix**: On `chrome.tabs.onUpdated` (with `tab.status === 'loading'`), detach the debugger for that tab:

```javascript
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    detachDebugger(tabId);
  }
});
```

---

## 🔵 MEDIUM (code quality, edge cases)

### M6 — Duplicate `safeText()` call in `addSystemMessage`

**File**: `extension/sidepanel.js`, lines 1517–1519
**Severity**: Low (no functional impact)

```javascript
function addSystemMessage(text) {
  text = safeText(text);
  text = safeText(text);  // ← duplicate
```

`safeText()` is called twice on the same input. The second call is redundant. Indicates hasty editing.

---

### M7 — Sidepanel ESM module pattern may cause compatibility issues

**File**: `extension/sidepanel.html`
**Severity**: Medium

`sidepanel.js` is loaded as `<script type="module" src="sidepanel.js">`. This was previously reverted in commit `0ad7f03` due to execution issues in extension side panels. It was re-added because `import` statements require it. However:

1. In module scripts, top-level `this` is `undefined`, not `window` (not used directly, but could break any third-party code)
2. `const $ = (sel) => document.querySelector(sel);` creates module-scoped variables, not globals — inline event handlers in HTML won't be able to reference them
3. `sendQuery` is reassigned (`sendQuery = async function()...`) which works in modules but is unusual

**Fix**: Either (a) bundle `lib/bang-commands.js` into sidepanel.js via a build step, or (b) document the module constraint clearly in AGENTS.md.

---

### M8 — No total conversation cap on storage (ticket #23 L2 — UNFIXED)

**File**: `extension/sidepanel.js`
**Severity**: Medium

Each conversation caps at 50 messages (MAX_HISTORY), but the total number of conversations stored in `cobrowse_convos` is unbounded. Over time, `chrome.storage.local` will hit the ~10MB quota, causing writes to fail silently.

**Fix**: In `saveConversations()` or `createNewConversation()`, enforce a total cap:

```javascript
if (Object.keys(conversations).length > 20) {
  const sorted = Object.entries(conversations).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const toDelete = sorted.slice(0, Object.keys(conversations).length - 20);
  for (const [id] of toDelete) delete conversations[id];
}
```

---

### M9 — Conversation persistence race between `addMessage` and `saveCurrentConversation`

**File**: `extension/sidepanel.js`
**Severity**: Medium

`addMessage()` calls `saveCurrentConversation()` internally, and `saveCurrentConversation()` is also called by `switchToConversation()` and `toggleHistoryView()`. If these overlap:
- `addMessage` is called while `sendQuery` is processing
- User switches conversations while a response is streaming
- The incorrect conversation's message array gets the new message

---

## ⚪ LOW (polish, maintainability)

### L4 — Backend relay.ts has no authentication

**File**: `backend/relay.ts`
**Severity**: Low (backend is not deployed)

The WebSocket relay has no auth mechanism. Any client with the URL can connect to any room. Since the relay is optional and not deployed, this is low priority but should be addressed before shipping multi-user sessions.

### L5 — CSS `[data-theme="light"]` override is missing for manual light mode toggle

**File**: `extension/styles.css`
**Severity**: Low

The CSS has `@media (prefers-color-scheme: light)` for auto light mode, and `[data-theme="dark"]` for manual dark override, but there is **no `[data-theme="light"]` block**. If the user manually selects light mode via the theme toggle, the CSS cascades from the system preference media query — which works if the system is in light mode, but fails if the system is in dark mode and the user manually selected light. The light variables won't apply.

**Fix**: Add a `[data-theme="light"]` block identical to the `@media (prefers-color-scheme: light)` block.

---

## Status of Ticket #23 Issues

| Issue | Status | Notes |
|-------|--------|-------|
| C1 — API URL double-append | ✅ Fixed in 6652a59 | |
| C2 — Reconnecting banner leak | 🟡 Fixed (uncommitted) | Working tree fix not yet committed |
| C3 — Debugger not detached on tab close | ✅ Fixed in 6652a59 | |
| C4 — Conversation continuity on SW restart | ✅ Fixed in 6652a59 | |
| H1 — Missing default case in message router | ✅ Fixed in 6652a59 | |
| H2 — Port re-created on every query | ✅ Fixed in 6652a59 | |
| H3 — Stale port race condition | ✅ Fixed in 6652a59 | |
| M1 — `escapeHtml` missing quote escaping | ✅ Fixed in 6652a59 | |
| **M2 — Options hardcoded API URLs** | ❌ **UNFIXED** | **This ticket (H4)** |
| M3 — `console.log` in production code | ✅ Fixed in 6652a59 | |
| M4 — Silent `.catch(() => {})` | 🟡 Partially fixed | Many still remain |
| **M5 — Context menu no debounce** | ❌ **UNFIXED** | **This ticket (H5)** |
| L1 — CSP inline script documentation | 🟡 Noted but undocumented | Add to AGENTS.md |
| **L2 — No total conversation cap** | ❌ **UNFIXED** | **This ticket (M8)** |
| L3 — Reconnecting banner text update vs remove | 🟡 Fixed (uncommitted) | Working tree fix resolves this |

## Status of Ticket #24 Issues

| Issue | Status | Notes |
|-------|--------|-------|
| C1 — SSE parser SyntaxError (duplicate `const data`) | ✅ Fixed in 54d7de9 | |
| C2 — Non-streaming fallback shows "Done." | ✅ Fixed in 54d7de9 | |
| C3 — End event missing output field | ✅ Fixed in 54d7de9 | |

## Files with Uncommitted Fixes

```
extension/background.js — sessionId propagation in streaming events (275 lines diff)
extension/sidepanel.js — thinking indicator cleanup in STREAM_DONE/port disconnect (11 lines diff)
extension/background.js.fixed — stale backup, NOT a clean version
```

These should be reviewed and committed.
