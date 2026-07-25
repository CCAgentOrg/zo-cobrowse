# #23 — Code Quality & Stability Audit

**Severity**: 🔴 Critical (multiple blocking defects)
**Effort**: Large
**Labels**: `bug`, `stability`, `quality`, `regression`

## Result

A thorough code review of `extension/background.js` (1363 lines), `extension/sidepanel.js` (2063 lines), `extension/options.js`, `extension/manifest.json`, and supporting files identified **4 critical (P0) defects** that explain the extension "stopped functioning," **3 high-severity reliability issues**, and **5 medium/low issues**.

---

## 🔴 CRITICAL (blocking — extension broken or silently failing)

### C1 — API URL double–append breaks four major features

**File**: `extension/background.js`
**Lines**: 1217, 1251, 1285, 1310

The default `config.zoApiUrl` is `'https://api.zo.computer/zo/ask'` — it already includes the `/zo/ask` path segment. **Four functions** (`savePageToWorkspace`, `createAutomation`, `listAutomations`, `runDuckdbQuery`) concatenate `${config.zoApiUrl}/zo/ask`, producing a URL of `https://api.zo.computer/zo/ask/zo/ask`. The Zo API returns 404 for this URL.

**Impact**: Four feature-level features are completely broken with default config:
- `!save` (save page to workspace)
- `!auto` (create automation from page)
- `!query` / `!data` (natural-language DuckDB query)
- Any UI path that calls these functions

**Root cause**: the config's default value should be `'https://api.zo.computer'` without the `/zo/ask` suffix, and all callers should append `/zo/ask` consistently. Currently, direct calls (`askZo`, `askZoStream`, `generatePreset`, `runSkill`) use `config.zoApiUrl` directly and work, while the four newer functions double-append.

**Fix**: Change the default to the base URL and append `/zo/ask` everywhere.

```diff
-  zoApiUrl: 'https://api.zo.computer/zo/ask',
+  zoApiUrl: 'https://api.zo.computer',
```

Then audit every call site — some use `${config.zoApiUrl}/zo/ask` and some use `config.zoApiUrl` directly. Standardise on a single pattern:

```js
const ZO_API = `${config.zoApiUrl}/zo/ask`;
```

---

### C2 — Reconnecting banner permanently leaks into DOM

**File**: `extension/sidepanel.js`
**Lines**: 1822–1831

When the background SW attempts a stream reconnection, it sends `STREAM_RECONNECT` events. The sidepanel creates a `<div class="msg msg-reconnecting">` with "Reconnecting..." text and appends it to the messages list. **This element is never removed** — neither `STREAM_CHUNK`, `STREAM_DONE`, nor `STREAM_ERROR` clears it. The banner accumulates in the DOM across reconnect cycles.

**Impact**: After any connection disruption, the UI permanently shows "Reconnecting... attempt X of Y" regardless of whether the stream actually recovered. This makes the extension appear perpetually broken to the user, and repeated cycles build up multiple stale banners.

**Root cause**: `STREAM_RECONNECT` is sent from `askZoStream()` on every retry attempt, but when `_askZoStreamImpl()` succeeds and returns, there is no `STREAM_RECONNECT_SUCCESS` event — only `STREAM_CHUNK` / `STREAM_DONE` follow. The sidepanel has no handler for clearing the reconnecting banner.

**Fix**: Add a `STREAM_RECONNECT_DONE` event sent from background after a successful retry connects, and remove the `.msg-reconnecting` element in the sidepanel on both that event and on `STREAM_CHUNK`.

---

### C3 — Debugger not detached on tab close (lifecycle leak)

**File**: `extension/background.js`
**Lines**: 269–285, 597

The `debuggerTabMap` tracks attached debuggers. When a tab closes, `detachDebugger` is called only in two places:
1. `evalInPage` on failure (line 297)
2. The `chrome.tabs.onRemoved` listener — **which does not exist**

There is no `chrome.tabs.onRemoved` listener. The only close-path reference is line 597 (`onMessage` → `RECONNECT` handler), which calls `detachDebugger(source.tabId)` — but that only fires when a user explicitly triggers a reconnect command from the sidepanel.

**Impact**: When tabs are closed normally, the debugger remains attached in Chrome's internal state. `debuggerTabMap` accumulates stale entries. Re-attaching to a recycled tab ID (e.g., after Chrome re-assigns it) silently fails since Chrome still believes the old session owns it.

**Fix**: Register a `chrome.tabs.onRemoved` listener that calls `detachDebugger(tabId)`.

---

### C4 — Service worker restart destroys conversation continuity

**File**: `extension/background.js`

`zoConversationId` is a module-level variable (`let zoConversationId = null;`). MV3 service workers can be terminated by the browser after ~30 seconds of inactivity (or 5 minutes with an active extension API connection). On restart, `zoConversationId` resets to `null`.

**Impact**: Mid-conversation, after a period of inactivity, every query starts a new conversation thread on Zo's backend — the model has no memory of the prior exchange. The user experiences the AI "forgetting" what was just discussed.

**Fix**: Persist `zoConversationId` to `chrome.storage.session` (MV3 ephemeral storage that survives SW restarts but not browser close):

```js
// On load:
const session = await chrome.storage.session.get('zoConversationId');
let zoConversationId = session.zoConversationId || null;

// On update:
await chrome.storage.session.set({ zoConversationId: 'conv_...' });
```

---

## 🟡 HIGH (functional degradation, data loss risk)

### H1 — Missing default case in message router hides failures

**File**: `extension/background.js`
**Lines**: 131–399

The `chrome.runtime.onMessage` switch statement has no `default:` case. Unrecognised or mistyped message types silently return `undefined` to the caller without any logging. During development, if a new message type is added to sidepanel.js but not yet handled in background.js, the failure is invisible.

**Fix**: Add a `default` handler:

```js
default: {
  console.warn(`Unhandled message type: ${request.type}`);
  sendResponse({ error: `Unknown message type: ${request.type}` });
}
```

---

### H2 — Port re-created on every query adds unnecessary overhead

**File**: `extension/sidepanel.js`
**Lines**: 1983–1985

`snedQuery()` calls `connectStreamingPort()` before every ASK_ZO message. If the port already exists, calling `chrome.runtime.connect()` again destroys the old port and creates a new one. This tears down an established connection unnecessarily and introduces a window where messages can be lost between the disconnect and the new connect completing.

**Fix**: Only connect if `streamPort` is null:

```js
if (!streamPort) connectStreamingPort();
```

Or add a healthy check: verify the port is alive before reusing it.

---

### H3 — Race condition: streamSession.active set after port postMessage

**File**: `extension/sidepanel.js`
**Lines**: 1993–1999

```js
streamSession.active = true;  // Set before the postMessage
streamSession.msgEl = null;
streamSession.fullText = '';
streamPort.postMessage({ ... });  // ASK_ZO sent
```

While `active` is set before `postMessage`, the `streamSession.sessionId++` increment occurs before this block. If `handleStreamMessage` receives a stale message from a *previous* port instance (which can happen when port reconnection races with SW restart), the `sessionId` check in `handleStreamMessage` may not reliably filter it.

**Fix**: Store the `sessionId` as a local variable captured in the send path and pass it as part of the ASK_ZO message. The background should echo it back in STREAM_CHUNK events so the sidepanel can ignore stale sessions.

---

## 🔵 MEDIUM (code quality, edge cases)

### M1 — `escapeHtml` does not escape `"` or `'`

**File**: `extension/sidepanel.js`
**Lines**: 888–894

```js
function escapeHtml(s) {
  s = safeText(s);
  if (s === '') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

Double-quote `"` and single-quote `'` are not escaped. While `markdownToHtml` escapes `"` in href attributes manually, any other code path using `escapeHtml` in an attribute context without additional quoting is vulnerable to HTML injection.

**Fix**: Add `'   .replace(/'/g, '&#39;').replace(/"/g, '&quot;')` to the chain.

---

### M2 — Options page hardcodes API base URL in three places

**File**: `extension/options.js`
**Lines**: 227, 272, 299

The test-connection, model-list, and persona-list fetches all hardcode `https://api.zo.computer/...` instead of using `config.zoApiUrl`. This means:
- If the user sets a custom API URL in storage, options still tests against the default
- These three endpoints will break if the API base ever changes

**Fix**: Read from `chrome.storage.sync` before fetching, or fall back to the DEFAULTS value.

---

### M3 — `console.log` in production code path

**File**: `extension/background.js`
**Lines**: 459

```js
console.log('Screenshot capture skipped:', e.message);
```

This is a user-visible error path that should use `console.warn` (distinguishable in the log) or the message should be surfaced to the user. `console.log` in shipped MV3 extensions appears in the service worker background console but is indistinguishable from debug output.

**Fix**: Use `console.warn` or include the message in the error returned to the sidepanel.

---

### M4 — `.catch(() => {})` swallows actionable errors

**File**: Multiple locations
**Lines**: background.js 153, 555, 583, 651, 658; sidepanel.js 1848

Several extension API calls (sidePanel.setPanelBehavior, tabs.sendMessage, etc.) have silent error handlers that catch but ignore errors. While many of these are best-effort calls where failure is acceptable, the pattern makes debugging difficult — transient failures that could indicate real problems are invisible even in verbose mode.

**Fix**: At minimum, add `console.debug` to silent catches in non-critical paths, with a brief comment explaining why the error is expected.

---

### M5 — No throttling for context-menu-triggered queries

**File**: `extension/background.js`
**Lines**: 547–583

Right-click → "Summarize this page" or "Ask Zo about this" fires a `sendMessage` to the sidepanel without any deduplication or debouncing. Rapid repeated right-clicks from the same source queue multiple PENDING_ZO_QUERY messages, which the sidepanel processes concurrently, creating multiple simultaneous Zo API calls.

**Fix**: Add a debounce (~500ms) on the context menu handler, keyed by `sender.tab.id + request.menuItemId`.

---

## ⚪ LOW (polish, maintainability)

### L1 — CSS `unsafe-inline` removed from extension_pages CSP but no fallback

**File**: `extension/manifest.json`

```json
"extension_pages": "script-src 'self'; object-src 'self'"
```

The CSP was tightened to remove `'unsafe-inline'`. This is correct for security, but it means any inline `<script>` tags or event handlers in extension pages will silently fail. The sidepanel and options page must rely entirely on external JS file binds. Currently they do, but any future inline script addition would break without a visible error in production.

**Fix**: No immediate change needed, but document in AGENTS.md that inline scripts are prohibited by the CSP.

---

### L2 — Sidepanel conversation history capped but not trimmed at the storage level

**File**: `extension/sidepanel.js`
**Lines**: Conversation save logic

Each conversation caps at 50 messages with a `slice(-50)`, but the `conversations` array itself (stored as `cobrowse_convos`) is unbounded. Switching between many conversations over time will grow the storage blob without limit, eventually hitting `chrome.storage.local` quota (~10MB).

**Fix**: Cap the total stored conversations at, e.g., 20 and drop the oldest when exceeded.

---

### L3 — Reconnecting banner uses textContent update instead of removing on success

**File**: `extension/sidepanel.js`
**Lines**: 1824–1830

The reconnect banner's text is updated via `.textContent`, but if the user trigger multiple rapid reconnects before a `STREAM_DONE`, multiple banners can accumulate. The `querySelector('.msg-reconnecting')` guard only prevents duplicate creation within the same render cycle — a `STREAM_DONE` + new `STREAM_RECONNECT` creates a second one.

**Fix**: On `STREAM_CHUNK` / `STREAM_DONE` / `STREAM_ERROR`, remove any `.msg-reconnecting` elements from the DOM.
