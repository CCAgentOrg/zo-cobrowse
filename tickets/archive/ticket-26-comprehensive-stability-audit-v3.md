# #26 — Comprehensive Stability & Code Quality Audit v3

**Date:** 2026-07-26
**Severity:** 🔴 Multiple P0/P1 defects remain operational
**Labels:** `bug`, `stability`, `quality`, `audit`

## Summary

This is a fresh audit of `extension/background.js`, `extension/sidepanel.js`, `extension/content.js`, `extension/options.js`, and `extension/manifest.json` after previous tickets #23, #24, and #25 had fixes applied. Tests pass at 140/140, 439 expect().

**Findings: 2 P0, 3 P1, 6 P2/P3 issues still present in the codebase.**

---

## 🔴 CRITICAL (P0 — features broken)

### C1 — Non-streaming fallback shows "Done." when Zo returns empty `output`

**File:** `extension/sidepanel.js` (overridden `sendQuery`, lines ~2071-2082)
**Root cause:** When `askZo()` (non-streaming via `chrome.runtime.sendMessage`) returns `{ success: true, output: "" }`, the fallback path parses the empty output. `JSON.parse("")` throws → `reasoning = ""`, `actions = []` → `doneResponse = ""` → `addMessage("assistant", "" || "" || "Done.")` → user sees "Done."

**Real trigger:** If Zo's model returns a non-streaming JSON response with `output: ""` (or `output: undefined`), or if the response arrives as `{}`, the fallback collapses to "Done." with zero user-facing text.

**Fix:** Before showing "Done.", check if the Zo API actually returned a conversation. If so, show the conversation ID or a less confusing message. Ideally, don't use "Done." as the universal fallback — use the raw output text even if it couldn't be parsed.

**Status:** ❌ Not fixed

### C2 — `handleStreamActions` + `STREAM_DONE` body update creates duplicate assistant messages

**File:** `extension/sidepanel.js` (STREAM_DONE handler ~lines 1797-1850, `handleStreamActions` ~lines 1875-1900)
**Root cause:** When Zo returns structured actions, the STREAM_DONE handler updates `streamSession.msgEl` body with `responseText` AND then calls `handleStreamActions(actions, msg.reasoning)` which may add ANOTHER assistant message. For navigate actions specifically:

1. STREAM_DONE updates the streaming body with the done response
2. `handleStreamActions` calls `addMessage('assistant', '📍 Navigating to: ...')` — NEW message
3. After 2s timeout, `handleStreamActions` calls `addMessage('assistant', doneResponse)` — YET ANOTHER message

User sees 3 messages for one Zo response, with the actual content duplicated.

**Fix:** Either (a) skip the body update when structured actions exist and let `handleStreamActions` handle all display, or (b) suppress `handleStreamActions` 's navigatemessage and done-response messages when there's already a streaming msgEl with content.

**Status:** ❌ Not fixed

---

## 🟡 HIGH (P1 — user-visible defects)

### P1-A — No `sessionId` in STREAM_CHUNK / STREAM_DONE / STREAM_ERROR response messages

**File:** `extension/background.js` (`finishStream`/`_askZoStreamImpl`), `extension/sidepanel.js` (`handleStreamMessage`)
**Root cause:** Background.js sends `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages via the port WITHOUT including the `msg.sessionId` field. The sidepanel's `handleStreamMessage` guard only filters messages that have `sessionId` set:

```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

Since `msg.sessionId` is `undefined` for all response messages, the condition is always falsy, and ALL messages from ALL sessions are accepted. If the user sends a second query before the first finishes responding, the two sessions' responses get mixed up in the UI. The guard does nothing.

**Fix:** Include `sessionId` from the original `ASK_ZO` message (or a session counter) in every response message. The port's `onMessage` could track a session counter and include it in all relayed responses.

**Status:** ❌ Not fixed

### P1-B — Overridden `sendQuery` uses pre-override `originalSendQuery` via `PENDING_ZO_QUERY` race

**File:** `extension/sidepanel.js` (init message listener ~line 259, override ~line 1906)
**Root cause:** There are TWO `sendQuery` definitions: the original `async function sendQuery()` at ~line 901, and the override `sendQuery = async function()` at ~line 1906. The init code registers a `chrome.runtime.onMessage` listener that calls `sendQuery()` when a `PENDING_ZO_QUERY` message arrives. If this listener fires BEFORE the override executes (which happens at parse time, but the listener is registered during init which runs asynchronously), the OLD `sendQuery` runs. The old version doesn't use the streaming port, so the response goes through the non-streaming fallback path which may show "Done."

In practice, since the script is a single `type="module"` the override should execute in order before the init. But the `onMessage` listener could fire on a future event loop tick, so this is a theoretical race.

**Fix:** Remove the original `async function sendQuery()` definition entirely and only keep the streaming override.

**Status:** ❌ Not fixed

### P1-C — MV3 Service Worker lifetime kills long streaming sessions

**File:** `extension/background.js` (`_askZoStreamImpl`)
**Root cause:** Manifest V3 background service workers terminate after 30 seconds idle / 5 minutes extended event processing. A long streaming Zo response could exceed this limit. When the SW terminates, the port disconnects, `streamSession.active = false`, and the sidepanel is stuck in "thinking" state with no recovery.

**Fix:** The uncommitted changes in `handleStreamMessage` handle the `!streamSession.active` case by showing the response as fallback text. But the problem is that the response messages NEVER ARRIVE because the port is dead. The actual fix needs to either (a) keep the SW alive during streaming, or (b) use `chrome.runtime.sendMessage` with periodic keepalive pings during long streams.

**Status:** 🟡 Partial fix in uncommitted changes, but the core problem (messages not arriving after SW death) is unfixed.

---

## 🔵 MEDIUM/LOW (P2/P3)

### P2-A — `domActions` variable computed but never used in STREAM_DONE

**File:** `extension/sidepanel.js` (STREAM_DONE handler, line ~1761)
**Issue:** `const domActions = (msg.actions || []).filter(...)` is computed at the top of the STREAM_DONE case but never used anywhere in the handler.

**Fix:** Remove dead code.

**Status:** ❌ Not fixed

### P2-B — `THINKING_TIMEOUT_MS` is defined but never used in the override `sendQuery`

**File:** `extension/sidepanel.js` (line 23, 114)
**Issue:** `const THINKING_TIMEOUT_MS = 60000` and `let thinkingTimeout = null` are declared but never wired into the streaming `sendQuery` path. If Zo takes longer than 60 seconds, the "thinking" indicator stays indefinitely with no timeout recovery.

**Fix:** Wire the timeout to show an error and re-enable input if exceeded.

**Status:** ❌ Not fixed

### P2-C — Options page `Test Connection` uses hardcoded URL, should use config URL

**File:** `extension/options.js` (~line 227)
**Issue:** Test Connection button uses `fetch('https://api.zo.computer/zo/ask', ...)` instead of reading from config (which could have a custom API endpoint). The uncommitted fix replaced `DEFAULTS.zoApiUrl` with the hardcoded URL to fix a ReferenceError, but a config-based approach is better.

**Fix:** Import config defaults from `lib/config.js` or read from `chrome.storage.sync`.

**Status:** 🟡 Workaround applied (hardcoded URL), not properly fixed.

### P2-D — `handleStreamActions` `runPendingActions()` can produce duplicate messages

**File:** `extension/sidepanel.js` (STREAM_DONE handler + `handleStreamActions` + `runPendingActions`)
**Issue:** When Zo returns DOM actions (click, fill, extract), the STREAM_DONE handler leaves the streaming body with `responseText` showing, then `handleStreamActions` sets up pending actions and runs them. Each action execution calls `addMessage('action', ...)` which adds another message. The user sees the action results duplicated — once in the streaming body and once as individual action messages.

**Status:** ❌ Not fixed

### P3-A — `addSystemMessage` duplicate `safeText` call

**File:** `extension/sidepanel.js` (~line 1518)
**Issue:** The uncommitted changes removed one `safeText` call, but the fix was incomplete — there's still one `safeText` call doing the right thing, but the comment says "duplicate removed".

**Status:** ✅ Fixed in uncommitted changes

### P3-B — No version field in stored conversations

**File:** `extension/sidepanel.js` (storage format)
**Issue:** Conversations stored in `chrome.storage.local` under `cobrowse_convos` have no schema version field. Future format changes cannot be migrated.

**Fix:** Include a `version: 2` (or higher) field in the conversation object and check it on load.

**Status:** ❌ Not fixed

---

## Fixed Since Previous Audits

| Issue | Ticket | Status |
|-------|--------|--------|
| SSE parser SyntaxError (duplicate `const data`) | #24 | ✅ Fixed in HEAD |
| "Done." when Zo returns done action without response | #24 | ✅ Fixed in HEAD |
| End event missing output field | #24 | ✅ Fixed in HEAD |
| `DEFAULTS` ReferenceError in options.js | #25 | ✅ Fixed (uncommitted) |
| `CREATE_AUTOMATION` wrong function signature | #25 | ✅ Fixed (uncommitted) |
| Port disconnect leaves UI stuck | #25 | ✅ Fixed (uncommitted) |
| Stale thinking indicators persist after STREAM_DONE | #25 | ✅ Fixed (uncommitted) |
| `askZoStream` sends STREAM_RECONNECT on first attempt | #26 | ✅ Fixed (uncommitted) |
| SSE content extraction too narrow | #26 | ✅ Fixed (uncommitted) |
| streamPort.postMessage unhandled exception | #26 | ✅ Fixed (this session) |
