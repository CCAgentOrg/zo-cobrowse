# #26 — Final Stability Audit & Remaining Defects

**Date:** 2026-07-26
**Severity**: 🔴 Critical (multiple P0/P1 defects still break the extension)
**Labels**: `bug`, `stability`, `quality`, `regression`

## Summary

Audit of `extension/background.js` (1401 lines), `extension/sidepanel.js` (2109 lines), `extension/content.js` (163 lines), `extension/options.js` (317 lines), and `extension/manifest.json` after tickets #23, #24, and #25 were applied.

Tests pass at 140/140. **Critical remaining issues found:** 2 P0, 4 P1, 6 P2/P3.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-A — Non-streaming fallback shows "Done." on empty Zo output

**Files**: `extension/sidepanel.js` (lines ~2071-2088)
**Status**: ❌ **Unfixed**

#### Symptom
When the streaming port is unavailable (background SW terminated), `sendQuery` falls back to `chrome.runtime.sendMessage`. If the Zo API returns empty/undefined `output`, the code shows "Done." because:
1. `output` is `undefined` → not an object, not a string → `reasoning = ''`, `actions = []`
2. `doneAction = undefined`, `doneResponse = ''`
3. `!actions.length` → `addMessage('assistant', '' || '' || 'Done.')` → "Done."

#### Root Cause
The output type check has no fallback for non-string, non-object, non-null output types (undefined, number, boolean). The fallback chain `reasoning || doneResponse || 'Done.'` needs to check `resp.output` directly before showing "Done."

#### Fix
Add a final safety check that shows the raw output if it exists, and wrap the port.postMessage in a try/catch so a dead port doesn't silently force the non-streaming fallback with no output.

---

### P0-B — STREAM_DONE "Done." fallback hit when msgEl is null and response is action-only

**Files**: `extension/sidepanel.js` (lines ~1795-1802)
**Status**: ❌ **Unfixed**

#### Symptom
When Zo returns a JSON response directly (non-streaming model detected producing a non-SSE JSON response), no `STREAM_CHUNK` events are sent. The `STREAM_DONE` arrives with `streamSession.msgEl = null`. If the response has only actions (no `responseText`), the code shows "Done." in the else branch's final else.

#### Root Cause
Three-way branch in the `else` block: `if (responseText)` → good path, `else if (msg.actions?.length)` → passive "will be rendered" comment, `else` → "Done." The middle branch doesn't actually render anything synchronously — it relies on `handleStreamActions` to do it, but if the navigate/done also fails to produce visible text, nothing appears.

#### Fix
Show reasoning text before falling back to "Done." in the else branch.

---

## 🟠 HIGH (P1 — user-facing breakage)

### P1-A — Port.postMessage disconnect race can permanently disable input

**File**: `extension/sidepanel.js` (line ~1992)
**Status**: ❌ **Unfixed**

#### Symptom
`streamPort.postMessage({...})` is called without a try/catch. If the port disconnects between the `if (streamPort)` check and the `postMessage` call (which can happen if the background SW terminates), an unhandled exception propagates. The `sendQuery` function never reaches `input.disabled = false`, leaving the input permanently disabled.

#### Root Cause
The port's `onDisconnect` handler fires asynchronously when the SW terminates. Between the null check and `postMessage`, the port is technically disconnected but not yet nulled. `postMessage` throws.

#### Fix
Wrap `streamPort.postMessage` in try/catch. On failure, fall through to the `chrome.runtime.sendMessage` path.

---

### P1-B — No `sessionId` in response events (STREAM_CHUNK, STREAM_DONE, STREAM_ERROR)

**File**: `extension/background.js` (`_askZoStreamImpl` and `finishStream`)
**Status**: ❌ **Unfixed**

#### Symptom
Response messages (`STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR`) don't carry the `sessionId` from the original `ASK_ZO` request. The sidepanel's session guard (`if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;`) passes ALL messages because `msg.sessionId` is falsy for all responses. This allows stale responses from previous sessions to leak into the active session when the user sends rapid queries.

#### Root Cause
The `sessionId` from the `ASK_ZO` message's `msg.sessionId` is never forwarded to any response messages in `_askZoStreamImpl` or `finishStream`.

#### Fix
Capture `sessionId` from the ASK_ZO message and pass it through to STREAM_CHUNK, STREAM_DONE, and STREAM_ERROR postMessage calls.

---

### P1-C — handleStreamActions duplicate message for navigate + done-response

**File**: `extension/sidepanel.js` (`handleStreamActions`, lines ~1879-1882)
**Status**: ❌ **Unfixed**

#### Symptom
When Zo returns a navigate action with a done response, `handleStreamActions` adds an assistant message for the navigation and then sets a 2-second timeout to add another message for the done response. Meanwhile, the STREAM_DONE handler's fallthrough code at line ~1806 may also add an assistant message. The user sees duplicate "Done." or response text.

#### Root Cause
`handleStreamActions` is called from the STREAM_DONE handler's action processing (line ~1825). For navigate actions, it returns early (line 1884) after setting up the setTimeout. But the STREAM_DONE handler's code after `handleStreamActions` still checks `doneAction` and may add another message.

#### Fix
Have `handleStreamActions` return a boolean indicating whether it handled the display, and skip the post-handler display if true.

---

### P1-D — Assistant responses not persisted when responseText is empty

**File**: `extension/sidepanel.js` (STREAM_DONE handler, lines ~1813-1822)
**Status**: ❌ **Unfixed**

#### Symptom
Conversation persistence only saves assistant messages when `responseText` is non-empty. If the model returns actions only (no done response text, no reasoning text), the response is never saved to conversation history.

#### Root Cause
The persistence check uses `if (responseText) {...}` but `responseText` can be empty even when actions exist.

#### Fix
Persist the assistant message if either responseText OR actions are present, using a fallback text like the action types performed.

---

## 🟡 MEDIUM (P2/P3 — quality & edge cases)

### P2-A — `addSystemMessage` has duplicate `safeText` call (cosmetic, no functional impact)

**File**: `extension/sidepanel.js`, line ~1517
**Status**: ❌ **Unfixed in committed code** (fixed in working tree)

One line has two `safeText` calls on the same value. The outer call is redundant.

---

### P2-B — Content script type selector `.filter(Boolean)` mismatch

**File**: `extension/content.js`, `captureContext()` function
**Status**: ❌ **Unfixed**

The `clickableEls` array uses `.filter(Boolean)` which passes all non-null entries but `buildSelector(el)` could theoretically return an empty string. Not an active bug but a latent issue.

---

### P2-C — `markdownToHtml` can throw on malicious input

**File**: `extension/sidepanel.js`, `markdownToHtml()` function
**Status**: ❌ **Unfixed**

The function does `escapeHtml(md)` at the start, then does regex replacements on the escaped HTML. Some regex patterns (especially the code block and table ones) could cause ReDoS (Regular Expression Denial of Service) on crafted input. Additionally, `escapeHtml` is a non-standard function that should be verified to exist.

---

### P2-D — No timeout for streaming fetch in background SW

**File**: `extension/background.js`, `_askZoStreamImpl()`
**Status**: ❌ **Unfixed**

The streaming fetch has no timeout. If the Zo API stalls mid-response (no data for 60+ seconds), the background SW hangs indefinitely. MV3 SWs have a 5-minute event lifetime, which may terminate the SW before the stream completes. After termination:
- Port disconnects → sidepanel shows no response
- Fetch is abandoned (no way to cancel cleanly)

---

### P2-E — `evalInPage` debugger banner

**File**: `extension/background.js`, `evalInPage()`
**Status**: ❌ **Unfixed**

`chrome.debugger.attach()` shows a yellow "Chrome is being debugged" banner at the top of every page tab. The debugger is attached for every context capture call (each user query). While the banner exists, some sites may behave differently (anti-debugging measures, pointer events disabled, etc.).

---

### P2-F — No storage quota enforcement

**File**: `extension/sidepanel.js`, conversation storage
**Status**: ❌ **Unfixed**

Conversations are stored in `chrome.storage.local` with a 50-message cap per conversation but no cap on total conversations. `chrome.storage.local` has a 10MB quota in most Chrome builds. Heavy users with many conversations could hit this limit silently, causing writes to fail.

---

## 📋 QA Check

| Area | Status |
|------|--------|
| Tests (bun test) | 140/140 pass |
| Content script loads on all_urls | ✅ manifest includes `<all_urls>` |
| Background SW type=module | ✅ |
| Sidepanel HTML imports module | ✅ (sidepanel.html loads sidepanel.js via import) |
| Options page loads correctly | ✅ |
| Port reconnection after SW restart | ❌ P1-A (unhandled exception) |
| SSE parser (Zo API format) | ✅ (tested for event: and data: variants, multiple content field names) |
| Non-streaming fallback for unsupported models | ❌ P0-A (shows "Done." on empty output) |
| Manifest permissions | ✅ debugger, contextMenus, sidePanel, storage, activeTab, tabs, scripting, tts |
| Host permissions | ✅ api.zo.computer, zo.space, http://*/*, https:///*/* |
| Conversation persistence | ✅ save/restore across sidepanel close/reopen |
| Preset persistence | ✅ custom presets stored and loaded |
| Theme persistence | ✅ sync storage, system/dark/light/sepia/forest/ocean |

## Migration notes
- All fixes are in `extension/` files — no API changes needed
- The uncommitted working tree has partial fixes for P0-B, P2-A, and port disconnect cleanup
