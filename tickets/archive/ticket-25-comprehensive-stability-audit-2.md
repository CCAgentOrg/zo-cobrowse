# #25 — Comprehensive Code Quality & Stability Audit (Round 2)

**Date**: 2026-07-26
**Status**: 🟡 Open
**Labels**: `bug`, `stability`, `quality`, `regression`

## Summary

A thorough review of the entire extension codebase (~6,500 lines across 7 source files plus tests) identified **1 critical (P0) defect still broken**, **3 high-severity (P1) issues**, **8 medium (P2) code quality issues**, and **4 low (P3) polish issues** that remain unfixed after tickets #23 and #24.

Changes since ticket #23: commit `6652a59` fixed C1/C3/C4/H1/H2/H3/M1/M3, commit `54d7de9` fixed C1/C2/C3 of the streaming "Done." bug. The working tree has additional uncommitted fixes for the reconnecting banner (C2 from ticket #23) and sessionId threading. **But several issues from #23 remain unfixed, and new ones were introduced by the streaming rewrite.**

---

## 🔴 CRITICAL (P0 — extension broken or silently fails)

### P0-1 — Options page "Test Connection" throws ReferenceError

**File**: `extension/options.js`  
**Line**: 227

The "Test Connection" button handler calls `fetch(DEFAULTS.zoApiUrl, ...)` but **`DEFAULTS` is never defined in options.js's scope**. `DEFAULTS` lives in `lib/config.js` and `background.js` — neither is imported or loaded by `options.html` (which uses `<script src="options.js">`, not a module import).

**Impact**: Every click of "Test Connection" throws a silent `ReferenceError: DEFAULTS is not defined`. The catch block shows `❌ DEFAULTS is not defined` in the UI instead of a meaningful connection test. The feature is completely broken.

**Root cause**: Options.js was refactored to reference DEFAULTS without importing it or duplicating the constant.

**Fix**: Either:
```js
const DEFAULTS = {
  zoApiUrl: 'https://api.zo.computer/zo/ask',
};
```
at the top of `options.js`, or import from `lib/config.js` (requires switching to `type="module"`). Prefer the inline constant since module scripts can cause compatibility issues in extension pages.

---

## 🟡 HIGH (P1 — functional degradation, edge case failures)

### P1-1 — SSE streaming rewrite may silently drop responses

**File**: `extension/background.js`  
**Status**: Introduced by the uncommitted working tree changes

The SSE parser was rewritten from a simple catch-all approach (any `data:` line triggered `FrontendModelResponse` by default) to an event-type-specific parser that dispatches based on `currentEventType`:

1. `PartStartEvent` — extracts `part.content`
2. `PartDeltaEvent` — extracts `delta.content_delta`
3. `FrontendModelResponse` — extracts `content`
4. `End` — extracts `output`
5. `completed` — finalizes
6. `Error` — reports error
7. Fallback — tries `JSON.parse` + content extraction

**Risks**:
- Any event type not in this list falls through to the fallback, which **only works if the data is valid JSON with a content/text field**. Plain text SSE data or non-JSON formats are silently dropped.
- The old code's `FrontendModelResponse` handler was the unguarded else-clause, meaning **any** data line was processed. The new code guards each event type with `if (currentEventType === '...')`, so unknown event types may not be handled.
- Zo's API format may evolve, and this parser is tightly coupled to the current SSE shape.

**Fix**: Add a robust catch-all at the end of the data-line processing that does NOT require JSON. If no recognized event type matched and no content was extracted, fall back to treating the data line as raw text:

```js
// After all event-type checks, catch-all
const rawContent = data; // Try to display data even if we don't recognize the event
if (rawContent) {
  visibleText += rawContent;
  port.postMessage({ type: 'STREAM_CHUNK', text: visibleText, sessionId: msgSessionId });
}
```

### P1-2 — Options page hardcodes API URLs in three places (carried over from ticket-23 M2)

**File**: `extension/options.js`  
**Lines**: 227 (test connection), `populateModels()` (`fetch('https://api.zo.computer/models/available')`), `populatePersonas()` (`fetch('https://api.zo.computer/personas/available')`)

The test connection, model list fetch, and persona list fetch all use hardcoded `https://api.zo.computer/...` URLs instead of the configured `zoApiUrl`. If a user configures a custom API endpoint, these features still hit the default URL.

**Status**: ❌ **Still open** (from ticket-23 M2)

**Fix**: Read `zoApiUrl` from storage (or fall back to default) and use it for all three fetches.

### P1-3 — Uncommitted fixes for critical C2 (reconnecting banner) and sessionId threading

**File**: Working tree (diff against HEAD)
**Status**: ⚠️ **Uncommitted**

The fix for the reconnecting banner leak (ticket-23 C2) and the sessionId threading for `finishStream()` calls exist only in the working tree, not in committed code. If the sandbox restarts or the working tree is reset, these fixes are lost. They must be committed.

Also, the `background.js.fixed` file is **not a valid fix file** — it has a syntax error on line 752 (duplicated string fragment) and is missing `sessionId` in multiple `finishStream()` calls. Delete this file and commit the actual working tree changes.

---

## 🔵 MEDIUM (P2 — code quality, maintainability, edge cases)

### P2-1 — No debounce on context-menu-triggered queries (carried over from ticket-23 M5)

**File**: `extension/background.js`  
**Lines**: 547–602

Rapid repeated right-clicks → "Ask Zo about this page" queue multiple simultaneous Zo API calls with no deduplication or debouncing.

**Status**: ❌ **Still open**

**Fix**: Add a 500ms debounce keyed by `sender.tab.id + menuItemId`.

### P2-2 — Unbounded conversation storage (carried over from ticket-23 L2)

**File**: `extension/sidepanel.js`  
**Functions**: `saveConversations()`, `createNewConversation()`

Each conversation caps at 50 messages, but the total number of conversations is unbounded. `chrome.storage.local` has ~10MB quota.

**Status**: ❌ **Still open**

**Fix**: Cap total conversations at 20, dropping oldest when exceeded.

### P2-3 — Content script `fill` action has ASI-dependent code

**File**: `extension/content.js`  
**Lines**: 76-78

```js
const el = (await waitForElement(action.selector)) 
el.focus();
```

Missing semicolon after the parenthesized await expression. Relies on Automatic Semicolon Insertion. While technically valid in most engines, this pattern is fragile:
- If the code is ever minified or concatenated with a preceding expression, ASI may not trigger
- The parenthesized expression `(await ...)` is unusual — most async patterns don't wrap in parens when assigning

**Fix**: Add semicolon:
```js
const el = await waitForElement(action.selector);
el.focus();
```

### P2-4 — `addSystemMessage()` calls `safeText()` twice

**File**: `extension/sidepanel.js`  
**Lines**: 1517-1519

```js
function addSystemMessage(text) {
  text = safeText(text);
  text = safeText(text);   // Duplicate call — no functional harm but sloppy
```

### P2-5 — `extension/background.js` has top-level `let` before `const DEFAULTS` in declaration order

**File**: `extension/background.js`  
**Lines**: 1-32

The file begins with:
1. `async function askZoStream()` (lines 1-19)
2. `function safeText()` (lines 22-28) 
3. Then at line 33: `const DEFAULTS = { ... }`
4. Then at line 51: `let config = { ...DEFAULTS }`

The functions `askZoStream` and `safeText` reference `config` and `DEFAULTS` *before* they are declared. While JavaScript hoisting makes function declarations available (because they use standard `function` syntax, not `const`/`let`), this is confusing and suggests the file was assembled by appending newer code at the top rather than organizing it logically.

**Fix**: Move `DEFAULTS` and `config` declarations to the top of the file, before any functions that reference them. Reorder the file to have a logical dependency structure: config → helpers → core logic → message handlers.

### P2-6 — `sidepanel.js` has module-scoped variables that appear global

**File**: `extension/sidepanel.js`

The file is loaded as `type="module"` and uses top-level `const $`, `let config`, `let pendingActions`, `function init()`, etc. In a module context, these are module-scoped (not global). If any inline script or console debugging attempts to reference `$`, `config`, etc., they won't be available. The file also has no exports — it's a pure side-effect module.

While functional, this pattern is confusing and makes debugging harder (you can't type `config` in the console to inspect state).

### P2-7 — `options.js` uses `async` `populateModels()` / `populatePersonas()` but they're called before `DOMContentLoaded` fires in some paths

**File**: `extension/options.js`

`populateModels()` and `populatePersonas()` are called from inside the `DOMContentLoaded` handler's `chrome.storage.local.get` callback, which is correct. But they modify the DOM using `document.getElementById()` after an `await` — the DOM is guaranteed to exist since they're inside the `DOMContentLoaded` callback, but this pattern is fragile if any future code calls them earlier.

**Fix**: Guard with `if (!container) return;` (which they already have) — current code is correct.

### P2-8 — Backend relay has no authentication

**File**: `backend/relay.ts`

The WebSocket relay allows anyone who knows the URL to join any room. No authentication, no rate limiting, no participant validation.

**Fix**: Add token-based auth to WebSocket connections or document that the relay is intended for trusted network environments only.

---

## ⚪ LOW (P3 — polish, maintainability)

### P3-1 — `sidepanel.html` loads Google Fonts on every panel open

Each time the side panel opens (or the service worker restarts), Google Fonts CSS is fetched. On slow connections, this delays panel rendering by hundreds of milliseconds.

**Fix**: Load fonts once and cache, or use system font fallback without Google Fonts import.

### P3-2 — `extension/background.js.fixed` file should be deleted

This file has a syntax error on line 752 and is missing `sessionId` parameters. It's not a valid fix file and should not remain in the repo.

### P3-3 — CSP `'unsafe-inline'` removal not documented in AGENTS.md (carried over from ticket-23 L1)

**Status**: ❌ **Still open**

The manifest CSP prohibits inline scripts. Future developers may unknowingly add inline event handlers. Document in AGENTS.md.

### P3-4 — No CI gate for the manifest `version` field

The manifest has been bumped to `0.0.1` but there's no automated check that the version matches release tags or that icons exist at declared paths.

---

## Issues Verified as Fixed by Previous Tickets

| Ticket | Issue | Fixed By | Status |
|--------|-------|----------|--------|
| #23 C1 | API URL double-append (4 features 404) | `6652a59` | ✅ |
| #23 C2 | Reconnecting banner DOM leak | Working tree (uncommitted) | ⚠️ Uncommitted |
| #23 C3 | Debugger tab close lifecycle | `6652a59` | ✅ |
| #23 C4 | Conversation continuity on SW restart | `6652a59` | ✅ |
| #23 H1 | Missing default case in message router | `6652a59` | ✅ |
| #23 H2 | Port re-creation on every query | `6652a59` | ✅ |
| #23 H3 | Stale port race condition | `6652a59` + working tree | ✅ |
| #23 M1 | escapeHtml missing quote escaping | `6652a59` | ✅ |
| #23 M3 | `console.log` in shipped code | `6652a59` | ✅ |
| #23 M4 | Silent `.catch(() => {})` | Partially (`console.debug` added) | ⚠️ Some remain |
| #23 L3 | Reconnecting banner textContent accumulation | Working tree | ⚠️ Uncommitted |
| #24 C1 | SSE parser SyntaxError | `54d7de9` | ✅ |
| #24 C2 | "Done." response on structured output | `54d7de9` | ✅ |
| #24 C3 | End event missing output field | `54d7de9` | ✅ |

---

## Test Suite Status

**140 tests across 13 files — 140 pass, 0 fail** (439 expect() calls)

The test suite passes but leaves significant gaps:
- No integration tests for the streaming SSE path (all SSE parsing is untested)
- No E2E tests for the sidepanel↔background message flow
- Tests use string matching (.toContain()) rather than Zod schema validation in most cases
- The `tests/remaining-coverage.test.ts` uses fragile `toMatch` patterns that pass as long as the substring exists anywhere in the code

---

## Key Files Affected

| File | Lines | Issues |
|------|-------|--------|
| `extension/background.js` | 1473 (~1200 after streaming rewrite) | P1-1, P2-5, P2-8, partial M4 |
| `extension/sidepanel.js` | 2110 | P2-2, P2-4, P2-6 |
| `extension/options.js` | 317 | **P0-1**, P1-2 |
| `extension/content.js` | 163 | P2-3 |
| `backend/relay.ts` | 186 | P2-8 |
| `extension/background.js.fixed` | 1472 | P3-2 (delete this) |

## Action Items

1. **Immediate**: Fix P0-1 (undef `DEFAULTS` in options.js) — blocked test connection
2. **Immediate**: Commit working tree changes (reconnecting banner fix + sessionId threading)
3. **Immediate**: Delete `background.js.fixed` (broken file)
4. **Short-term**: Fix P1-1 (SSE fallback for unknown event types)
5. **Short-term**: Fix P1-2 (options.js hardcoded URLs)
6. **Medium**: Fix P2-1 through P2-7 (code quality issues)
7. **Ongoing**: Add streaming SSE integration tests
