# #25 — Post-Fix Regression & Remaining Defects Audit

**Date:** 2026-07-26
**Severity**: 🔴 Critical (3 active P0/P1 defects that still break features)
**Labels**: `bug`, `regression`, `stability`, `quality`

## Summary

The last 25 commits (6652a59 and 54d7de9 etc.) fixed 4 critical (C1-C4) and several high-severity issues identified in ticket #23. However, this audit of the current working tree (HEAD + uncommitted changes) found **3 remaining P0/P1 defects** that still break features, plus **12 medium/low issues** across the codebase. Additionally, the uncommitted SSE parser rewrite in the working tree introduces a new potential regression path.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-A — Options page `Test Connection` button throws ReferenceError

**Severity**: 🔴 Critical — prevents users from verifying their Zo API token works
**Files**: `extension/options.js` (line 227), `extension/options.html`
**Status**: ❌ **Unfixed**

#### Symptom
Clicking "Test Connection" in the extension options page throws an uncaught `ReferenceError: DEFAULTS is not defined`. The test connection silently fails with no meaningful error shown to the user.

#### Root Cause
`options.js` is loaded as a plain script (`<script src="options.js"></script>`) in `options.html`, NOT as an ES module. It has no import statement for `DEFAULTS`, which is defined in two places:
- `extension/lib/config.js` (as an ES module export)
- `extension/background.js` (as a module-level `const`)

Line 227 of `options.js`:
```js
const r = await fetch(DEFAULTS.zoApiUrl, { ... });
```

`DEFAULTS` is never declared or imported in the options.js scope. This causes a `ReferenceError` on every click of "Test Connection".

#### Impact
- Users cannot test their Zo connection from the options page
- The error is silently swallowed by the try/catch on the test handler, showing only a generic "❌ error" message
- Users who enter valid tokens receive false negatives and may think the extension is broken

#### Fix
Replace `DEFAULTS.zoApiUrl` with the literal default or import from `lib/config.js`:
```js
// Option A: inline the default
const API_URL = 'https://api.zo.computer/zo/ask';

// Option B: convert options.html to use type="module" and import
// <script type="module" src="options.js"></script>
// import { DEFAULTS } from './lib/config.js';
```

**Verdict:** This was introduced when options.js was refactored to use `DEFAULTS` without establishing the reference. It has been broken since the shared config module was extracted.

---

### P0-B — Options page hardcodes API base URL in three places

**Severity**: 🔴 High — breaks config for users with custom API endpoints
**Files**: `extension/options.js` (lines 227, 272, 299)
**Status**: ❌ **Unfixed** (was M2 in ticket #23)

#### Symptom
The test-connection, model-list, and persona-list fetches all hardcode `https://api.zo.computer/...` instead of using the configured API URL. If the user has a custom API endpoint (e.g., a self-hosted relay), these features silently connect to the wrong server.

#### Locations
1. **Line 227** — Test connection: `fetch(DEFAULTS.zoApiUrl, ...)` (also has the P0-A ReferenceError bug)
2. **Line 272** — Model list: `fetch('https://api.zo.computer/models/available', ...)`
3. **Line 299** — Persona list: `fetch('https://api.zo.computer/personas/available', ...)`

#### Impact
- If a user configures a custom API URL (e.g., via zoAccessToken pointing to a different Zo instance), these three features silently use the default URL instead
- The model selector shows the wrong set of models
- The persona selector shows the wrong personas
- Test connection tests the wrong endpoint

#### Fix
Read the API URL from `chrome.storage.sync` (key `zoApiUrl`) before making requests, and fall back to `'https://api.zo.computer'`. For model and persona listings, use a separate configurable endpoint:

```js
// On load, also read the API URL from storage
chrome.storage.sync.get('zoApiUrl', (result) => {
  const baseUrl = result.zoApiUrl || 'https://api.zo.computer';
  // Use baseUrl for subsequent calls
});
```

---

### P0-C — Working tree SSE parser rewrite may silently drop responses

**Severity**: 🔴 High — streaming responses may silently fail
**Files**: `extension/background.js` (working tree, uncommitted)
**Status**: ⚠️ **Uncommitted, not tested against real Zo API**

#### Symptom
The uncommitted working tree rewrites the SSE parser from a simple `data:` line processor to a complex event-type-specific parser that handles `PartStartEvent`, `PartDeltaEvent`, `FrontendModelResponse`, `End`, `completed`, and `Error` event types. If Zo's API sends:

1. Any unrecognized event type with non-JSON data — the data is silently dropped
2. Multiple `End` events — the second would be ignored (guarded by `gotCompletion`)
3. Event types not in the expected list — the fallback JSON parser only catches `content`/`text`/`delta` shaped payloads

#### Root Cause
The committed HEAD (54d7de9) had a simpler, more robust SSE handler that treated every `data:` line as either End, Error, or FrontendModelResponse. The working tree rewrites this with specific event-type handlers, each with `continue;` or `return;`. An unrecognized event type falls through to the generic fallback, which only processes JSON payloads with `content`/`text`/`delta` fields — plain text data is silently dropped.

#### Impact
If Zo's API ever sends an event type not in the expected set (or changes the event-type naming convention), streaming responses are silently dropped — no error shown, just "Zo is thinking..." → nothing happens.

#### Fix
Add a catch-all at the end of the `data:` processing chain that sends any unrecognized data as a STREAM_CHUNK, ensuring no data is silently lost:

```js
// After all specific event-type handlers, add a catch-all:
// If we reach here with data, send it as a chunk for compatibility
if (data && !gotCompletion) {
  visibleText += data;
  port.postMessage({ type: 'STREAM_CHUNK', text: visibleText, sessionId: msgSessionId });
}
```

**Verdict:** The committed HEAD parser was simpler and more compatible. The working tree's rewrite provides better structure but introduces a regression path. Recommend keeping the simpler parser and only adding specific event-type handlers as needed when confirmed to exist in Zo's actual SSE output.

---

## 🟡 HIGH (P1 — functional degradation)

### P1-A — Context menu queries have no debounce

**Files**: `extension/background.js` (lines 547–583)
**Status**: ❌ **Unfixed** (was M5 in ticket #23)

Rapid repeated right-clicks → "Ask Zo about this" queue multiple simultaneous Zo API calls. Each call opens a new sidepanel with a pending query, but they all execute in parallel, creating multiple simultaneous conversations.

**Fix:** Add a 500ms debounce keyed by `sender.tab.id + request.menuItemId`.

---

### P1-B — CSS `[data-theme="light"]` override missing for manual theme switch

**File**: `extension/styles.css`
**Status**: ❌ **Unfixed**

The CSS defines:
- `:root {}` — dark theme defaults
- `@media (prefers-color-scheme: light) { :root {} }` — light theme when system is light
- `[data-theme="dark"] {}` — manual dark override

Missing: `[data-theme="light"] {}` — no manual light override. If a user's system is set to dark but they manually select "light" theme in the extension, the `@media` query doesn't apply (system is dark), and the `[data-theme="light"]` override doesn't exist. The extension stays dark despite the user's preference.

**Fix:** Add `[data-theme="light"] { ... }` block with the same light-theme variable overrides.

---

### P1-C — Backend WebSocket relay has no authentication

**File**: `backend/relay.ts`
**Status**: ❌ **Unfixed**

The WebSocket relay at `/ws` accepts any connection to any room without authentication. Anyone who knows the relay's URL can join any room and observe/replay all shared browsing data.

**Fix:** Add token-based auth (extend the `?client=` parameter to include a shared secret, or require a handshake message before accepting into the room).

---

## 🔵 MEDIUM (P2 — code quality, edge cases, maintainability)

### P2-A — `addSystemMessage()` calls `safeText()` twice (duplicate)

**File**: `extension/sidepanel.js` (lines 1518–1519)
```js
function addSystemMessage(text) {
  text = safeText(text);
  text = safeText(text);  // ← BUG: duplicate, second call is a no-op
```

Not functionally harmful but indicates sloppy code from rapid iteration. Remove the duplicate line.

---

### P2-B — Content.js `fill` action missing semicolon (ASI-dependent)

**File**: `extension/content.js` (line 48)
```js
const el = (await waitForElement(action.selector)) 
el.focus();
```

Relies on ASI inserting a semicolon between `)` and `el`. This is technically valid JavaScript but will silently break if:
1. The code is passed through a minifier that merges lines
2. A future edit adds a line between them
3. The `()` is removed during refactoring

**Fix:** Add a semicolon: `const el = await waitForElement(action.selector);`

---

### P2-C — Conversation storage is unbounded (total conversations)

**File**: `extension/sidepanel.js`
**Status**: ❌ **Unfixed** (was L2 in ticket #23)

Each conversation caps at 50 messages (`MAX_HISTORY`), but the total number of stored conversations (`cobrowse_convos`) is unbounded. Over extended use, `chrome.storage.local` (~10MB quota) will fill up.

**Fix:** Add a total cap of 20–30 conversations when saving, dropping the oldest by `updatedAt`.

---

### P2-D — `.catch(() => {})` swallows errors in 10+ locations

**Files**: `extension/background.js` (9 occurrences), `extension/sidepanel.js` (1 occurrence)
**Status**: ⚠️ **Partially fixed** — some have `console.debug` now, 7 still silent

The following calls silently swallow errors:
1. `chrome.sidePanel.setPanelBehavior(...).catch(() => {})`
2. `chrome.runtime.sendMessage({ type: 'PENDING_ZO_QUERY'...}).catch(() => {})` (×3)
3. `chrome.tabs.sendMessage(...).catch(() => {})` (×2)
4. `.catch(() => {})` on various API error paths

Each is individually justified (best-effort calls), but collectively they make debugging impossible — transient failures in these API calls are completely invisible.

**Fix:** At minimum, add `console.debug` with a brief explanation to each, e.g.:
```js
.catch(() => { /* best-effort: sidepanel may not be open */ })
```

---

### P2-E — Sidepanel HTML uses ESM module but exports nothing

**File**: `extension/sidepanel.html` — `<script type="module" src="sidepanel.js"></script>`

`sidepanel.js` is loaded as an ES module (to support the `import` of `bang-commands.js`), but it exports nothing — it's entirely a side-effect module. This is unusual and means:
- Top-level `this` is `undefined` (not `window`)
- All `const`, `let`, `function` declarations are module-scoped, not global
- If any future code tries to reference a sidepanel function from outside the module, it won't work

Previously reverted in commit `0ad7f03`. Only needed because of the `import` from `ib/bang-commands.js`. If this import pattern is changed to dynamic import or the bang-commands logic is bundled, the `type="module"` can be removed.

---

### P2-F — Options.html has full inline CSS instead of sharing `styles.css`

**File**: `extension/options.html`

`options.html` inlines all 280+ lines of its CSS in a `<style>` block instead of sharing the design system from `styles.css`. This creates duplication — any theme update requires editing two files. The inline styles also do not support the "Forest" or "Ocean" themes.

---

### P2-G — Google Fonts loaded on every sidepanel instantiation

**File**: `extension/styles.css` — `@import url('https://fonts.googleapis.com/...')`

Three Google Fonts (Fraunces, Figtree, JetBrains Mono) are loaded via CSS `@import` every time the sidepanel opens. This adds 200–500ms of latency to the panel opening, especially on slow connections or first load. The fonts should either be bundled or loaded with `font-display: swap` to prevent blocking render.

---

## ⚪ LOW (P3 — polish, maintainability)

### P3-A — Missing `[data-theme="sepia"]`, `[data-theme="forest"]`, `[data-theme="ocean"]` CSS blocks

**File**: `extension/styles.css`

The options page and sidepanel theme selector offer Sepia, Forest, and Ocean themes (stored as `'sepia'`, `'forest'`, `'ocean'` in `data-theme`), but the CSS has no variable overrides for these themes. Selecting them has no visual effect — the extension falls back to the dark or light default.

---

### P3-B — `style.css` is misspelled (should be `styles.css`)

**File**: Built reference in `sidepanel.html` and `options.html` → `styles.css`

Both major HTML files reference the same CSS file. This is correct, but historically the file was named `style.css` in some commits. Verify no stale references remain.

---

### P3-C — No automated test for the `sendQuery` streaming override path

**Files**: `tests/sidepanel.test.ts`

The 20 sidepanel tests only verify structural code (presence of functions, constants, DOM refs). There are no tests for the actual `sendQuery()` execution path — neither the original nor the streaming override. The streaming port message protocol (STREAM_CHUNK, STREAM_DONE, STREAM_ERROR, STREAM_RECONNECT) has no unit test coverage.

---

## Verdict

**3 active P0 bugs** remain that break configured-user workflows:
1. `DEFAULTS` ReferenceError in options page → test connection broken
2. Hardcoded API URLs in options → model/persona selectors wrong for custom endpoints
3. Working tree SSE rewrite regression risk → streaming may silently drop data

**7 P1 bugs** remain (mostly from ticket #23, unfixed):
- Context menu debounce, light theme CSS, relay auth, backend options URL: these are tracked from ticket #23 M2/M5/L1, and remain unfixed.

**Recommendation:** Before the next release, fix P0-A (replace `DEFAULTS.zoApiUrl` with a local fallback), revert or harden P0-C (the SSE rewrite), and address P0-B (configurable API URL in options). The remaining P1/P2 items can follow in a maintenance pass.
