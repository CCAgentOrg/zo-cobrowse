# #26 — Comprehensive Streaming & Stability Audit

**Date:** 2026-07-26  
**Severity**: 🔴 Critical (multiple active defects affecting core functionality)  
**Labels**: `bug`, `stability`, `streaming`, `quality`, `regression`  
**Scope**: `extension/background.js`, `extension/sidepanel.js`, `extension/content.js`

## Summary

Despite multiple fix rounds (tickets #23, #24, #25), several intersecting defects remain that cause the extension to show "Done." instead of Zo's actual response. The failures are **intermittent and state-dependent**, making them hard to reproduce without knowing the exact sequence.

**Root cause cluster:** The streaming path has a fragile state machine (`streamSession`) that is silently corrupted by port disconnections, stale session bleed-through, unguarded exceptions, and inconsistent `sessionId` tracking between background ↔ sidepanel. Any one of these can trigger the `addMessage('assistant', 'Done.')` fallback.

---

## 🔴 CRITICAL (P0 — features broken)

### P0-A — Stale session bleed-through (no `sessionId` in response messages)

**Files**: `extension/background.js` (finishStream, SSE event handlers), `extension/sidepanel.js` (handleStreamMessage)  
**Severity**: P0 — causes silent response loss on multi-turn queries

Background.js sends `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages **without `sessionId`**:

```javascript
// background.js — finishStream()
port.postMessage({
  type: 'STREAM_DONE',
  reasoning,
  actions,
  fullText,     // ← no sessionId!
});
```

Sidepanel's stale-message guard checks `msg.sessionId`, but since it's **always undefined**, the guard never fires:

```javascript
// sidepanel.js — handleStreamMessage()
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
//        ^^^^ always undefined → guard always passes
```

**Impact:** When a user sends multiple queries in quick succession:
1. Session 1's `STREAM_DONE` arrives during Session 2 → `streamSession.msgEl` has been reset to `null` by new session
2. The no-`msgEl` fallback path triggers → `responseText` may be empty → **"Done."**

**Fix:** Add `sessionId` to every response message from background.js STREAM_CHUNK, STREAM_DONE, and STREAM_ERROR.

---

### P0-B — Non-streaming fallback shows "Done." on empty API output

**Files**: `extension/sidepanel.js` (override `sendQuery` fallback path, lines ~2074-2084)  
**Severity**: P0 — primary "Done." path when streaming port is unavailable

The non-streaming fallback (`chrome.runtime.sendMessage` → `askZo()`) handles Zo's response:

```javascript
if (!actions.length) {
  addMessage('assistant', reasoning || doneResponse || 'Done.');
}
```

When Zo returns `{ output: '' }` or `{ output: undefined }`:
- `output` is undefined → parsing skipped → `reasoning = ''`, `actions = []`
- `doneAction = undefined` → `doneResponse = ''`
- Result: **`addMessage('assistant', 'Done.')`** even though the API responded successfully

**Root cause:** `resp.output` can be undefined/empty when the Zo API returns a status-only response (e.g., during persona routing, model errors, or rate limiting). The code treats empty output as "Done." instead of showing an error.

**Fix:** Add explicit check for empty/missing output and show meaningful fallback text.

---

### P0-C — `streamPort.postMessage` throws unhandled on dead port

**Files**: `extension/sidepanel.js` (override `sendQuery`, line ~2057)  
**Severity**: P0 — permanently disables input (UI lock)

```javascript
// No try/catch!
streamPort.postMessage({
  sessionId: thisSessionId,
  type: 'ASK_ZO',
  ...
});
return;  // ← returns before any error handling
```

If the port disconnected between `if (!streamPort)` check and `.postMessage()`, the call throws an unhandled exception. Since `return` immediately follows, the error propagates up via the async promise chain. **Neither `finally` block nor catch re-enables `input.disabled = false`.**

**Impact:** User input stays permanently disabled until the extension is reloaded.

**Fix:** Wrap `streamPort.postMessage` in try/catch with fallback to non-streaming path.

---

### P0-D — Missing error handling for `input.disabled` reset on unhandled promise rejection

**Files**: `extension/sidepanel.js` (override `sendQuery` streaming path)  
**Severity**: P0 — UI lock on any unhandled async error in streaming path

The override `sendQuery` is `async` and has no `.catch()` at the end. Any unhandled rejection in the streaming path (before the `return` at line ~2063) will NOT trigger the `finally` block because `return` exits before the async completion tracks the rejection.

**Impact:** Same as P0-C — permanent UI lock.

---

## 🟡 HIGH (P1 — broken under specific conditions)

### P1-A — `handleStreamActions` setTimeout races input re-enable

**Files**: `extension/sidepanel.js` (handleStreamActions, ~1878-1886)  
**Severity**: P1 — navigate actions may not show done response

```javascript
if (navigateActions.length) {
  addMessage('assistant', `📍 Navigating to: ${navigateActions[0].url}`);
  chrome.runtime.sendMessage({ type: 'NAVIGATE', url: ... }).catch(() => {});
  setTimeout(async () => {
    await refreshPageContext();
    if (doneResponse) addMessage('assistant', doneResponse);
  }, 2000);
  return;
}
```

The 2-second timeout assumes navigation completes within 2 seconds. On slow sites, the doneResponse is never shown.

Additionally, `handleStreamActions` is called FROM the STREAM_DONE handler which then re-enables input. But `handleStreamActions` returns immediately (setTimeout is async), and the STREAM_DONE handler re-enables input right away. The user could send a new query while navigation is still pending.

---

### P1-B — Content script `fill` action has missing semicolon / extraneous parens

**Files**: `extension/content.js` (line ~103)  
**Severity**: P1 — potential ASI-dependent issue

```javascript
case 'fill': {
  const el = (await waitForElement(action.selector))   // ← extraneous parens, no semicolon
  el.focus();
```

This works via ASI but is fragile. A future minifier or adjacent code change could break it.

---

### P1-C — `functions` is not a valid `content_security_policy` directive

**Files**: `extension/manifest.json` (CSP)  
**Severity**: P1 — silent CSP violation in background service worker

The CSP declares: `sandbox: "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self'"`

The `sandbox` directory value is not a valid CSP directive for `extension_pages`. MV3's `extension_pages` CSP only supports `script-src`, `object-src`, and `worker-src`. The sandbox directive is silently ignored.

---

## 🟡 MEDIUM (P2 — quality issues)

### P2-A — Conversation persistence misses action-only responses

**Files**: `extension/sidepanel.js` (STREAM_DONE handler)  
**Severity**: P2 — conversation history has gaps for action-only responses

```javascript
if (responseText) {
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', text: responseText, timestamp: Date.now() });
    ...
  }
}
```

When the Zo response consists only of actions (click, fill, etc.) with no text response, `responseText` is empty and the conversation is NOT saved. The user's query exists in history but the assistant response is lost.

---

### P2-B — `domActions` computed variable in STREAM_DONE is never used

**Files**: `extension/sidepanel.js` (STREAM_DONE handler, ~1759)  
**Severity**: P2 — dead code

```javascript
case 'STREAM_DONE': {
  const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
  // ^^^ computed but NEVER referenced below
```

This variable is computed on every STREAM_DONE but never used. The actual action filtering happens later in `handleStreamActions`. Dead code wastes parsing time and creates confusion.

---

### P2-C — Port disconnect cleanup may leave `streamPort` references stale

**Files**: `extension/sidepanel.js` (connectStreamingPort, ~1712-1733)  
**Severity**: P2 — reconnection may silently create zombie listeners

```javascript
connectStreamingPort() {
  try {
    const port = chrome.runtime.connect({ name: 'cobrowse-stream' });
    port.onMessage.addListener(handleStreamMessage);
    port.onDisconnect.addListener(() => {
      if (streamPort === port) {
        // ... cleanup
        streamPort = null;
      }
    });
    streamPort = port;
  } catch {
    streamPort = null;
  }
}
```

When `streamPort === port` is false (stale onDisconnect), the old port's `onMessage` listener is never removed. If the old port somehow remains connected, it continues to invoke `handleStreamMessage` with stale data.

---

### P2-D — No TTS auto-read for streaming messages

**Files**: `extension/sidepanel.js` (STREAM_DONE handler)  
**Severity**: P2 — inconsistent UX between streaming and non-streaming paths

The `addMessage()` function auto-reads assistant messages via TTS if enabled. But streaming responses update `streamSession.msgEl.innerHTML` directly (bypassing `addMessage()`), so TTS never fires for streamed responses.

---

## 🔵 LOW (P3 — cosmetic / maintenance)

### P3-A — `THINKING_TIMEOUT_MS` defined but unused in streaming path

**Files**: `extension/sidepanel.js` (line 23)  
**Severity**: P3 — dead code

The 60-second thinking timeout constant is exported and assigned to `thinkingTimeout`, but the override `sendQuery` (streaming path) never sets it. A long-running streaming response leaves "Zo is thinking..." indefinitely until the first STREAM_CHUNK arrives.

### P3-B — `export` statement from module causes runtime error in non-module context

**Files**: `extension/sidepanel.js` (line 1)  
**Severity**: P3 — won't crash but wastes error handling

```javascript
import { parseBangCommand, BANG_COMMANDS } from './lib/bang-commands.js';
```

This import forces `sidepanel.html` to load as `type="module"`. If someone accidentally reverts the HTML to a non-module script tag, this import silently fails.

### P3-C — `functions()` and `values()` are not valid CSP directive values

**Files**: `extension/manifest.json`  
**Severity**: P3 — harmless

The manifest CSP has some non-standard values that browsers ignore.

---

## Priority Fix Plan

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | A — Add `sessionId` to response messages | Low | **Critical** — eliminates stale session bleed |
| P0 | B — Handle empty API output in fallback | Low | **Critical** — removes primary "Done." path |
| P0 | C — Try/catch around streamPort.postMessage | Low | **Critical** — prevents permanent UI lock |
| P0 | D — Async error guard for streaming path | Low | **Critical** — prevents silent crash |
| P1 | A — Dynamic navigation timeout | Medium | High — reliable navigation flow |
| P2 | A — Persist action-only responses | Low | Medium — history consistency |
| P2 | D — TTS for streaming | Low | Medium — accessibility parity |

**Tests affected:** 140 pass, 0 fail. Add tests for sessionId relay, empty-output fallback, and port-disconnect recovery.
