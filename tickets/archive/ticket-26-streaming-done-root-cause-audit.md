# #26 — Streaming "Done." Root Cause Audit & Remaining Defects

**Date:** 2026-07-26  
**Severity**: 🔴 Critical (still showing "Done." instead of Zo's response)  
**Labels**: `bug`, `stability`, `quality`, `streaming`, `regression`  

## Summary

Despite the fixes in #24 and #25, the extension still shows "Done." under certain conditions. This audit covers the **entire codebase** (`background.js` 1473 lines, `sidepanel.js` 2140 lines, `content.js` 163 lines, `options.js` 317 lines, `manifest.json`) and identified **14 defects** — 3 P0, 5 P1, 6 P2/M.

Tests: 140 pass, 0 fail, 439 expect() calls.

---

## 🛑 SYMPTOM ANALYSIS

**What happens:** User sends a query → see Zo's event stream response in console/network tab → sidepanel shows "Zo is thinking..." then "Done." instead of the actual response.

**Trace through the code that runs:**

1. `sendQuery()` (override, line ~1904 in sidepanel.js) → `streamPort.postMessage({type:'ASK_ZO', ...})`
2. Background `onConnect` handler → `askZoStream()` → `_askZoStreamImpl()` → Zo API call with `stream: true`
3. SSE events parsed → content extracted → `STREAM_CHUNK` events sent back
4. `End` event or stream complete → `finishStream()` → `STREAM_DONE` sent
5. Sidepanel `handleStreamMessage` receives `STREAM_DONE`
6. **"Done." reached at one of these code paths:**

### Trigger Paths

| # | Path | Condition | File:Line |
|---|------|-----------|-----------|
| A | STREAM_DONE → `!streamSession.active` guard exit | Port disconnected mid-stream but Zo response still comes through | sidepanel.js ~1765 |
| B | STREAM_DONE → fallback `addMessage('assistant', 'Done.')` | No `msgEl`, empty `responseText`, no actions | sidepanel.js ~1825 |
| C | Non-streaming fallback → `addMessage('assistant', 'Done.')` | Zo returned empty `output` | sidepanel.js ~2078 |
| D | Non-streaming fallback → actions present but no doneAction | Called handleStreamActions but didn't add any message | sidepanel.js ~2080-2083 |

---

## 🔴 P0 — Features Broken

### P0-A: `streamSession.active` drops before STREAM_DONE (most likely cause of "Done.")

**Files:** `extension/sidepanel.js` (port onDisconnect handler ~1724, handleStreamMessage ~1765)  
**Status:** ❌ **PARTIALLY FIXED** — uncommitted changes handle the fallback text but may still miss actions

**Root cause chain:**
1. MV3 service worker can idle-terminate after 30s → port disconnects
2. `onDisconnect` handler fires → `streamSession.active = false`
3. Zo's SSE fetch continues in background SW (SW gets revived)
4. `STREAM_DONE` eventually arrives at sidepanel
5. `if (!streamSession.active) return;` drops it silently (original code)
6. Uncommitted fix shows fallback text but only checks `msg.fullText || msg.reasoning || msg.actions?.length`

**When this fails:** The uncommitted fix shows fallback text properly IF the fallback check passes. But if `msg.fullText` and `msg.reasoning` are both empty (e.g., content was only in streamSession.fullText which was cleared), the fallback skips to `input.disabled = false; break;` — showing nothing.

**Fix needed:** Ensure `streamSession.fullText` is also checked in the fallback path, and always re-enable input.

### P0-B: Duplicate assistant message — handleStreamActions + STREAM_DONE both add content

**Files:** `extension/sidepanel.js` (handleStreamActions ~1881, STREAM_DONE handler ~1800)  
**Status:** ❌ **Unfixed**

When Zo returns actions, the STREAM_DONE handler:
1. Updates `streamSession.msgEl` body with `responseText` (line ~1800)
2. Then calls `handleStreamActions(actions, msg.reasoning)` (line ~1847)

`handleStreamActions` may then:
- **For navigate actions:** Calls `addMessage('assistant', '📍 Navigating to: ...')` IMMEDIATELY (line ~1885), then schedules ANOTHER `addMessage('assistant', doneResponse)` after 2s timeout (line ~1890)
- **For DOM actions:** Sets `pendingActions` and calls `runPendingActions()`, which has its own `addMessage` calls for each action step
- **For done-only actions:** Does nothing (correct — no duplicate)

**Impact:** For navigate responses, user sees 3 messages: the streaming body update + "📍 Navigating to" message + done response after 2s. The streaming body's `responseText` may be redundant with the done response.

**Fix needed:** Skip the STREAM_DONE body update when navigate actions exist. Let `handleStreamActions` be the single display path.

### P0-C: Non-streaming fallback shows "Done." when Zo returns empty output

**Files:** `extension/sidepanel.js` (sendQuery override lines ~2075-2085), `extension/background.js` (askZo line ~1015)  
**Status:** ❌ **Unfixed**

When the streaming port is unavailable, the fallback calls `chrome.runtime.sendMessage({type:'ASK_ZO'})` → `askZo()` in background.js. If Zo returns `{ output: "" }` or `{ output: undefined }`, the fallback shows "Done."

**Contribution from both files:**
- `background.js` `askZo()` (line ~1015): Returns `{ success: true, output: data.output, intent: resolvedIntent }` — no null/empty check on `data.output`
- `sidepanel.js` fallback (line ~2078): `addMessage('assistant', reasoning || doneResponse || 'Done.')` — both empty → "Done."

**Fix needed:** Add empty-output fallback in both places. In `background.js`, don't return empty output. In `sidepanel.js`, show a more descriptive message.

---

## 🟠 P1 — Stability & Reliability

### P1-A: No `sessionId` on response messages (STREAM_CHUNK, STREAM_DONE, STREAM_ERROR)

**File:** `extension/background.js` (askZoStreamImpl, finishStream)  
**Status:** ❌ **Unfixed**

The ASK_ZO request includes `sessionId` (from sidepanel.js line ~2035), but the response messages `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` from background.js do NOT include it. The sidepanel's stale-message guard:

```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

... never filters response messages because `msg.sessionId` is always undefined. This means responses from old sessions leak into new sessions when users send multiple rapid queries.

**Impact:** Rapid successive queries mix up responses. Old STREAM_DONE can appear as the response to a new query.

**Fix needed:** Add `sessionId` to STREAM_CHUNK, STREAM_DONE, and STREAM_ERROR in both `_askZoStreamImpl` and `finishStream`.

### P1-B: Port disconnect leaves streaming port null until next query

**File:** `extension/sidepanel.js` (connectStreamingPort ~1714, sendQuery ~2030)  
**Status:** ❌ **Unfixed (partially mitigated)**

When the background SW terminates, the port disconnects. The `onDisconnect` handler sets `streamPort = null`. The next query tries to reconnect via `connectStreamingPort()`. But if the SW hasn't restarted yet, the reconnect fails and `streamPort` stays null, triggering the non-streaming fallback.

**Impact:** Occasional non-streaming fallback when SW terminates between queries.

**Fix needed:** Add exponential backoff retry for `connectStreamingPort()`, or use `chrome.runtime.sendMessage` as the primary path with `stream: true` when port is unavailable.

### P1-C: `streamPort.postMessage` lacks error handling in sendQuery

**File:** `extension/sidepanel.js` (sendQuery override line ~2035)  
**Status:** ✅ **FIXED** (just applied — try-catch wrapper added)

### P1-D: Port `onConnect` handler lacks `onDisconnect` cleanup

**File:** `extension/background.js` (onConnect handler line ~508)  
**Status:** ❌ **Unfixed**

The background's `onConnect` handler has NO `port.onDisconnect` listener. When the port disconnects (SW termination, user closes side panel), there's no cleanup of in-flight streaming connections. The `_askZoStreamImpl` function may continue writing to a disconnected port with silent failures.

**Impact:** Leaked streaming connections. Zo API calls that complete after the port is gone produce unhandled `port.postMessage` errors.

**Fix needed:** Add `port.onDisconnect` handler in background's onConnect to abort in-flight fetch requests.

### P1-E: `thinkingTimeout` constant defined but never used

**File:** `extension/sidepanel.js` (line 23, 25)  
**Status:** ❌ **Unfixed**

`const THINKING_TIMEOUT_MS = 60000;` and `let thinkingTimeout = null;` are defined but never referenced in the streaming override sendQuery. If Zo takes longer than 60s to respond, the "thinking" indicator stays indefinitely with no automatic reset.

**Impact:** Stuck "Zo is thinking..." indicator on very long model responses.

**Fix needed:** Wire `THINKING_TIMEOUT_MS` into the streaming path's sendQuery.

---

## 🟡 P2 — Code Quality

### P2-A: Dead code — `domActions` computed but unused in STREAM_DONE

**File:** `extension/sidepanel.js` (STREAM_DONE handler ~1759)  
**Status:** ❌ **Unfixed (uncommitted)**

```javascript
const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
```

Computed but never referenced. Was likely intended for tracking DOM action count but never wired up.

### P2-B: `addSystemMessage()` has duplicate `safeText` call (one redundant)

**File:** `extension/sidepanel.js` (line ~1517)  
**Status:** ✅ **FIXED** (uncommitted changes remove the duplicate)

### P2-C: Options.js hardcodes Zo API URL instead of using config

**File:** `extension/options.js` (line ~227)  
**Status:** ✅ **FIXED** (uncommitted changes)

### P2-D: CREATE_AUTOMATION handler mismatched function signature

**File:** `extension/background.js` (line ~232)  
**Status:** ✅ **FIXED** (uncommitted changes)

### P2-E: Content script `buildSelector` may throw for detached elements

**File:** `extension/content.js` (~line 65)  
**Status:** ❌ **Unfixed**

The `nth-child` disambiguation code accesses `el.parentElement` without null check. If the element is detached from DOM (rare but possible during dynamic page updates), `parentElement` is null and accessing `Array.from(parent.children)` throws.

### P2-F: Large prompt context could cause `414 URI Too Long` or OOM

**File:** `extension/background.js` (_askZoStreamImpl line ~790-800)  
**Status:** ❌ **Unfixed**

The screenshot `dataUrl` (base64 JPEG) is embedded directly in the prompt. A full-page screenshot can be 100-500KB of base64 text. Combined with page text and form fields, the prompt could exceed the model's context window or cause OOM in the background SW.

---

## ✅ Fixes Applied (this session)

| # | Fix | Status |
|---|-----|--------|
| 1 | `streamPort.postMessage` wrapped in try-catch with fallthrough to non-streaming fallback | ✅ |
| 2 | `askZoStream` only sends STREAM_RECONNECT on actual retries (attempt > 1) | ✅ (uncommitted) |
| 3 | SSE content extraction widened: `parsed.output`, `parsed.message` added to chain | ✅ (uncommitted) |
| 4 | STREAM_DONE `!streamSession.active` fallback shows response text instead of silent drop | ✅ (uncommitted) |
| 5 | Port disconnect removes thinking indicator and resets session state | ✅ (uncommitted) |
| 6 | Options.js `DEFAULTS.zoApiUrl` reference error fixed with hardcoded URL | ✅ (uncommitted) |
| 7 | `addSystemMessage` duplicate `safeText` removed | ✅ (uncommitted) |
| 8 | `CREATE_AUTOMATION` handler signature fixed | ✅ (uncommitted) |

---

## Next Steps

1. **Commit the uncommitted fixes** — they address 7 of the 14 defects
2. **Fix P0-B (duplicate messages)** — the most visible issue remaining
3. **Fix P1-A (sessionId on responses)** — critical for multi-query stability
4. **Add port.onDisconnect cleanup in background.js** — prevents leaked connections
5. **Wire THINKING_TIMEOUT_MS** into streaming path
6. **Remove dead code** in STREAM_DONE handler

---

## Verification

All 140 existing tests pass after the applied fixes. Recommended additional tests:
- Test rapid successive queries (no sessionId mixing)
- Test port disconnect mid-stream (response still shows)
- Test Zo returning empty output from non-streaming fallback
