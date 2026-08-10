# #26 — Streaming Stability & "Done." Response Fix (Root Cause Analysis)

**Date**: 2026-07-26
**Severity**: 🔴 Critical
**Status**: 🔧 Needs commit

## Symptom
Extension shows "Zo is thinking..." → "Done." despite Zo API returning a valid response (eventstream visible in DevTools network tab).

## Root Cause Analysis

### C1 — SSE End event fullText preserved [Background] (P0)

**File**: `extension/background.js`, `_askZoStreamImpl` — End event handler  
**Root cause**: When the `End` event arrives with `data: {}`, the old code skipped `fullText` parsing entirely — but `parsed.output` from each individual chunk's `FrontendModelResponse` already accumulated the response text. The code then called `finishStream(port, fullText, ...)` where `fullText` contained the accumulated content. **This is already handled correctly** (fullText is accumulated from chunk content fields).

However, if the model returns **all** its content in the `End` event's `data.output` field and sends empty `FrontendModelResponse` chunks, the content extraction from chunks fails because `parsed.content` is empty. The uncommitted fix adds `parsed.output` to the content extraction chain.

**Fix already applied**: `parsed.output` and `parsed.message` added to `rawContent` chain.

### C2 — `streamSession.active` guard drops legitimate STREAM_DONE [Sidepanel] (P0)

**File**: `extension/sidepanel.js`, `handleStreamMessage` → `STREAM_DONE` handler  
**Root cause**: The `if (!streamSession.active) return;` guard silently drops STREAM_DONE responses. This happens when:
- MV3 SW terminates mid-stream, the port disconnects, `streamSession.active = false`
- The response eventually arrives but is dropped
- No error or fallback is shown to the user

**Fix already applied** (uncommitted): When `!streamSession.active`, the handler now processes the response via `addMessage` fallback and calls `handleStreamActions` instead of silently returning.

### C3 — SSE parser had duplicate `const data` declaration [Background] (P0)

**File**: `extension/background.js`, SSE line parser  
**Root cause**: SyntaxError on every `data:` line due to duplicate `const data` in same block scope.  
**Fix already applied** (committed in 54d7de9): Consolidated to single regex match.

### C4 — No `sessionId` in response messages [Background+Sidepanel] (P1)

**File**: `extension/background.js` (`finishStream`, `_askZoStreamImpl`), `extension/sidepanel.js`  
**Root cause**: `STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR` messages don't include `sessionId`. The sidepanel's message guard (`if (msg.sessionId && ...)`) passes all messages regardless of session, because `msg.sessionId` is undefined for response messages. This means:
- If user sends Query B while Query A is still streaming, both sessions' responses are mixed in the UI
- If port reconnects mid-stream, stale STREAM_DONE from old port may arrive during new session
- The `sessionId` field is inconsistently present (ASK_ZO has it, responses don't)

**Status**: ❌ Still present — needs fix

### C5 — No error handling for `streamPort.postMessage()` [Sidepanel] (P1)

**File**: `extension/sidepanel.js`, override `sendQuery` function  
**Root cause**: `streamPort.postMessage({...})` is called without try/catch. If the port disconnected between the `if (streamPort)` check and the `postMessage` call, the error propagates uncaught, leaving inputs disabled.

```javascript
if (streamPort) {
    streamPort.postMessage({...});  // ← BANG! If port died between check and send
    return;  // ← inputs never re-enabled
}
```

**Status**: ❌ Still present — needs fix

### C6 — Conversation persistence misses streaming assistant messages [Sidepanel] (P1)

**File**: `extension/sidepanel.js`, `handleStreamMessage` → `STREAM_DONE` handler  
**Root cause**: The streaming path uses `addMessageDOM()` directly (not `addMessage()`), so assistant messages are rendered in the DOM but NOT persisted to `chrome.storage.local` conversation storage. Persistence only happens when `responseText` is non-empty via a separate `conv.messages.push()` call.

Non-streaming fallback path: uses `addMessage()` which includes `saveCurrentConversation()` — no bug here.

If `responseText` is empty (action-only response, e.g., `{actions: [{type: "click"}]}`), the assistant message is rendered but never saved. On sidepanel reopen, the conversation is missing.

**Status**: ❌ Still present — needs fix

### C7 — Port `onDisconnect` cleanup doesn't re-enable input [Sidepanel] (P1)

**File**: `extension/sidepanel.js`, `connectStreamingPort`  
**Root cause**: When the port disconnects mid-stream (MV3 SW restart), the `onDisconnect` handler removes thinking indicator but doesn't re-enable the input or send button. User is stuck with disabled inputs until they refresh the panel.

**Fix already applied** (uncommitted): Added `if (streamSession.active)` cleanup in port disconnect handler.

### C8 — `options.js` Test Connection throws ReferenceError [Options] (P0)

**File**: `extension/options.js`, line ~227  
**Root cause**: `DEFAULTS.zoApiUrl` referenced but `DEFAULTS` is not defined in options.js scope (it's in background.js).  
**Fix already applied** (uncommitted): Hardcoded URL replaced `DEFAULTS.zoApiUrl`.

### C9 — `CREATE_AUTOMATION` handler wrong signature [Background] (P1)

**File**: `extension/background.js`, onMessage handler  
**Root cause**: `createAutomation` was called with `(pageContext, trigger, action)` but sidepanel sends `(instruction, rrule, pageContext)`.  
**Fix already applied** (uncommitted): Corrected call to `(request.instruction || '', request.rrule || 'FREQ=DAILY', request.pageContext)`.

### C10 — Markdown table regex wrong attribute order [Sidepanel] (P2)

**File**: `extension/sidepanel.js`, `markdownToHtml`  
**Bug**: The link regex has `target` before `rel`:
```javascript
return '<a href="..." target="_blank" rel="noopener noreferrer">...'  
```
This is syntactically valid but unconventional order. The rel should ideally come before target per modern HTML conventions. **Low severity**.

### C11 — `open_webpage` / `open` typos in error messages [Background] (P0 — typo only)

**File**: `extension/background.js`, error handling in executeActions  
**Root cause**: Variable name `result` checked after content script path uses wrong property:
```javascript
if (resp.ok && resp.value && resp.value.ok) context = resp.value;  // uses resp not result
```

**Status**: ✅ No actual bug — the code uses `resp` correctly for the content script response. Verified.

## Summary

| ID | Issue | Severity | Status | File |
|----|-------|----------|--------|------|
| C1 | End event content extraction | P0 | ✅ Fixed (uncommitted) | background.js |
| C2 | streamSession.active drops STREAM_DONE | P0 | ✅ Fixed (uncommitted) | sidepanel.js |
| C3 | Duplicate `const data` SyntaxError | P0 | ✅ Fixed (54d7de9) | background.js |
| C4 | No sessionId in response messages | P1 | ❌ **Unfixed** | background.js + sidepanel.js |
| C5 | Unchecked streamPort.postMessage | P1 | ❌ **Unfixed** | sidepanel.js |
| C6 | Streaming messages not persisted | P1 | ❌ **Unfixed** | sidepanel.js |
| C7 | Port disconnect doesn't re-enable input | P1 | ✅ Fixed (uncommitted) | sidepanel.js |
| C8 | Options DEFAULTS ReferenceError | P0 | ✅ Fixed (uncommitted) | options.js |
| C9 | CREATE_AUTOMATION wrong signature | P1 | ✅ Fixed (uncommitted) | background.js |
| C10 | Markdown table attr ordering | P2 | ❌ **Unfixed** | sidepanel.js |
