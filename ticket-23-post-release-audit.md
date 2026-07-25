# Ticket #23 — Post-Release Stability Audit: Root-Cause Fixes

## Summary

The extension stopped functioning after streaming support was added. Three critical bugs — two `ReferenceError` crashes and one DOM-mutation bug — broke both the streaming query path and the settings page. Below is the full audit, ordered by blast radius.

---

## 🔴 Critical (extension broken)

### 1. `msgSessionId` ReferenceError in `askZoStream()` — **STREAMS BROKEN**

**File:** `extension/background.js` lines 1–16  
**Severity:** CRITICAL — every stream query silently fails

The streaming retry wrapper `askZoStream(port, msg)` references `msgSessionId` on lines 8–9, but **never extracts it from `msg`**. The variable is only destructured inside the called function `_askZoStreamImpl()` — it does not exist in `askZoStream`'s scope.

```js
// background.js:1 — askZoStream(port, msg) — msgSessionId NOT extracted
async function askZoStream(port, msg) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1)
        port.postMessage({ type: 'STREAM_RECONNECT_DONE', sessionId: msgSessionId }); // 💥 ReferenceError
      port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries, sessionId: msgSessionId }); // 💥 ReferenceError
      return await _askZoStreamImpl(port, msg);
    } catch (err) { /* retries 3 times, all fail */ }
  }
  throw lastError;
}

// background.js:749 — _askZoStreamImpl(port, msg) — sessionId extracted HERE only
async function _askZoStreamImpl(port, msg) {
  const { ..., sessionId: msgSessionId } = msg; // only exists here
```

**Effect:** Every stream query hits `ReferenceError: msgSessionId is not defined`. The outer `try/catch` in `port.onMessage` catches it after all retries fail and sends `STREAM_ERROR` to the sidepanel. The user sees an error for every query.

The retry logic on the **first attempt** throws immediately at line 9 (first `msgSessionId` use in the loop body, since `attempt > 1` is `false` on the first pass). All 3 retries fail. The error surfaces as `"Failed: msgSessionId is not defined"` in the sidepanel.

**Fix:** Extract `sessionId` from `msg` at the top of `askZoStream`:

```js
async function askZoStream(port, msg) {
  const { sessionId: msgSessionId } = msg; // ← add this
  // ... rest unchanged ...
}
```

**Related:** Because streams crash, the overridden `sendQuery` in sidepanel.js (the streaming path) always falls to the `STREAM_ERROR` handler, which means **every query shows an error** with no completed response.

---

### 2. `DEFAULTS` ReferenceError in `options.js` — **TEST CONNECTION BROKEN**

**File:** `extension/options.js` line 168  
**Severity:** CRITICAL — clicking "Test Connection" crashes

```js
// options.js:168 — inside testBtn click handler
const r = await fetch(DEFAULTS.zoApiUrl, {
```

`DEFAULTS` is defined only in `background.js` as a module-level const. It is **never imported or defined** in `options.js`. When the user clicks "Test Connection", this throws `ReferenceError: DEFAULTS is not defined`.

**Fix:** Replace with the inline URL:

```js
const r = await fetch('https://api.zo.computer/zo/ask', {
```

---

### 3. `populatePersonas()` appends same DOM node to both selects — **LITE PERSONA SELECT EMPTY**

**File:** `extension/options.js` lines ~238–246  
**Severity:** HIGH — lite persona dropdown shows no options

```js
for (const p of data.personas) {
  const opt = document.createElement('option');
  opt.value = p.id || '';
  opt.textContent = p.name || p.id || '';
  liteSelect.appendChild(opt);   // opt moves to liteSelect
  fullSelect.appendChild(opt);   // 💀 opt moves from liteSelect to fullSelect
}
```

`appendChild` **moves** the DOM node, it doesn't copy it. After the loop, `liteSelect` is empty and `fullSelect` has all options. The user cannot select a different lite persona.

**Fix:** Clone the node for the second append:

```js
fullSelect.appendChild(opt.cloneNode(true));
```

---

## 🟡 Quality & stability issues

### 4. `sendQuery` full override duplicates ~90 lines of logic

**File:** `extension/sidepanel.js` (line ~1710 → end of file)

The streaming path replaces the entire `sendQuery` function by reassignment (`sendQuery = async function() { ... }`), copying the bang-command dispatch, context validation, and error handling. Any change to the non-streaming path must be manually mirrored in the override. This is fragile and caused one copy to diverge.

**Fix:** Extract shared logic into a `_prepareQuery()` helper and inject only the streaming transport difference, or keep one `sendQuery` that branches inside.

### 5. `addSystemMessage` double-calls `safeText` + raw `innerHTML`

**File:** `extension/sidepanel.js`

```js
function addSystemMessage(text) {
  text = safeText(text);
  text = safeText(text);  // redundant call, harmless but sloppy
  msgsEl.innerHTML += `<div ...>${text}</div>`;  // text is string-coerced but not HTML-escaped
}
```

`safeText` converts to string but does **not** HTML-escape. System messages come from preset names/descriptions (user-controlled). Low risk since only the user configures presets, but inconsistent with `addMessageDOM` which routes through `markdownToHtml` → `escapeHtml`.

### 6. `handleStreamActions` may double-display done responses

**In the fallback (non-streaming) path** of the overridden `sendQuery`, when actions contain both DOM actions and a `done` action:

```js
handleStreamActions(actions, reasoning);  // may fire addMessage('assistant', doneResponse) via setTimeout
if (doneAction && !hasNavigate) {
  addMessage('assistant', doneResponse || reasoning || 'Done.'); // fires AGAIN
}
```

If there are DOM actions but no navigations, the response text appears twice.

### 7. Zo API schema mismatch — `output` field could be string or object

Both `askZo()` and `_askZoStreamImpl()` try to parse Zo's `output` as both string (via `JSON.parse`) and object. The dual-parsing pattern is fragile — when the model returns plain text (no JSON), the error paths create confusing error messages or silent failures.

The AGENTS.md notes that `output_format` with `type: "array"` was reported unsupported. This should be tested and, if fixed in the API, adopted to eliminate the dual parsing.

### 8. Storage listener sets `undefined` without clearing the key

```js
// background.js:101-102
else if (changes.zoAccessToken?.oldValue && !changes.zoAccessToken?.newValue)
  config.zoAccessToken = undefined;
```

Setting `config.zoAccessToken = undefined` leaves the key present with an undefined value. Callers checking `if (config.zoAccessToken)` would pass (falsy), but `JSON.stringify` and `fetch` will omit it, so this is mostly cosmetic — values survive in chrome.storage.

---

## 🔧 Fix checklist

| # | File | Line(s) | Fix | Priority |
|---|------|---------|-----|----------|
| 1 | `background.js` | 1 | Add `const { sessionId: msgSessionId } = msg;` at top of `askZoStream` | 🔴 Now |
| 2 | `options.js` | 168 | Replace `DEFAULTS.zoApiUrl` with hardcoded URL `'https://api.zo.computer/zo/ask'` | 🔴 Now |
| 3 | `options.js` | 245 | Use `opt.cloneNode(true)` for `fullSelect.appendChild` | 🔴 Now |
| 4 | `sidepanel.js` | ~1710 | Refactor `sendQuery` to avoid full-duplicate pattern | 🟡 Soon |
| 5 | `sidepanel.js` | `addSystemMessage` | Remove duplicate `safeText`, add `escapeHtml` | 🟡 Soon |
| 6 | `sidepanel.js` | streaming fallback | Guard against double `done` display | 🟡 Soon |

---

## How to test the fixes

1. **Streaming:** Open sidepanel, type any query, verify green checkmark `STREAM_DONE` with response text (not `STREAM_ERROR`).
2. **Test Connection:** Open Settings → click "Test Connection" → see success/failure message (not blank/error).
3. **Personas:** Open Settings → verify both Lite and Full persona dropdowns show the same list of personas.
4. **Regression:** `bun test` must pass all 126 tests.

---

*Audited 2026-07-26 by Zo — all findings verified against running source.*
