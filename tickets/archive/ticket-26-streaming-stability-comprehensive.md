# #26 — Streaming Stability & "Done." Response Comprehensive Audit

**Date:** 2026-07-26  
**Severity:** 🔴 Critical (3 active P0/P1 defects remain after tickets #23-#25 fixes)  
**Effort:** High  
**Labels:** `bug`, `stability`, `streaming`, `regression`

## Executive Summary

Previous tickets #23 (code quality), #24 (streaming done response), and #25 (post-fix regression audit) applied ~20 fixes to the SSE parser, STREAM_DONE fallback text, port disconnect handling, and options page. Several uncommitted fixes are also in the working tree. **However, 3 critical defects remain** that still cause the "Done." symptom despite successful Zo API responses visible in DevTools.

---

## 🔴 P0 DEFECTS (features broken)

### P0-A — Zo returns plain text (non-JSON) → shows "Done." via STREAM_DONE fallback

**Files:** `extension/sidepanel.js` (STREAM_DONE handler, lines ~1820-1826)  
**Status:** ❌ Remains broken

#### Symptom
When Zo returns a plain text response (not JSON with `actions`/`reasoning`), and the SSE streaming already accumulated content in `streamSession.msgEl`, the STREAM_DONE handler:
1. Sets `responseText` from `doneAction?.response || msg.fullText || streamSession.fullText || msg.reasoning`
2. Updates `streamSession.msgEl` body with `responseText`
3. Calls `handleStreamActions([], "")` (empty actions)

This works for the `streamSession.msgEl` branch. **But** for the **no-streaming-chunks branch** (`else` at line ~1820), when `responseText` is empty AND `msg.actions?.length` is 0, "Done." is shown.

This happens specifically when Zo's API returns a **non-streaming JSON response** (for models that don't support SSE), reaching `finishStream(port, data.output || '', ...)` with an empty output string. `data.output || ''` → `''` → `finishStream(port, '', ...)` → empty reasoning + actions → STREAM_DONE with empty fields → "Done." in sidepanel.

**Root cause:** `finishStream()` (background.js) has no guard against empty `data.output`. The empty string is treated as valid and passed through to the sidepanel, which has no text to display.

#### Fix
In `finishStream()`, when `output === ''` and no actions were found, include a useful fallback message instead of passing through empty string:

```javascript
function finishStream(port, output, intent) {
  // ...existing parsing logic...
  
  // If we have no text and no actions, provide a meaningful fallback
  if (!output && !reasoning && !actions.length) {
    output = 'Zo returned an empty response. Try rephrasing your query.';
    reasoning = output;
  }
  
  // ...rest of function...
}
```

Also in sidepanel's STREAM_DONE handler `else` branch, add `msg.fullText` to the fallback chain before "Done.":

```javascript
} else {
  // No streaming chunks — fallback to addMessage
  const fbText = responseText || safeText(msg.fullText);
  if (fbText) {
    addMessage('assistant', fbText);
  } else if (msg.actions?.length) {
    // Response is in actions — handled by handleStreamActions
  } else {
    addMessage('assistant', 'Done.');
  }
}
```

---

### P0-B — `handleStreamActions` + STREAM_DONE duplicate assistant messages on navigate

**Files:** `extension/sidepanel.js` (handleStreamActions + STREAM_DONE handler)  
**Status:** ❌ Remains broken

#### Symptom
When Zo returns actions with both a `navigate` and a `done` action (e.g., `{type: "navigate", url: "..."}` and `{type: "done", response: "..."}`), the STREAM_DONE handler:

1. Updates `streamSession.msgEl` body with `responseText` (= done action response)
2. Calls `handleStreamActions(actions, reasoning)` which:
   a. Adds `"📍 Navigating to: ..."` as a NEW assistant message (duplicate 1)
   b. Schedules a `setTimeout` to add the done response after 2 seconds (duplicate 2)
3. After 2s, the timed-out message adds the done response AGAIN

Net result: 3 messages for one Zo response — the original streaming body, the navigate message, and the done response. Plus, `handleStreamActions` never re-enables input for navigate-only cases — the done response is shown after 2 seconds but the input remains disabled during that interval.

#### Fix
Skip the STREAM_DONE body update for action-based responses and let `handleStreamActions` own the display completely:

In STREAM_DONE handler, only update `streamSession.msgEl` when there are NO structured actions:

```javascript
if (streamSession.msgEl) {
  const body = streamSession.msgEl.querySelector('.msg-body');
  if (!msg.actions?.length) {
    // Plain text — update the streaming body
    body.innerHTML = markdownToHtml(responseText);
  }
  // For action-based responses — let handleStreamActions own the display
}
```

And in `handleStreamActions`, only add the navigate message if it hasn't already been shown by the STREAM_DONE handler.

---

### P0-C — `streamPort.postMessage` unhandled rejection can lock UI permanently

**Files:** `extension/sidepanel.js` (sendQuery override, line ~2033)  
**Status:** ❌ **Has partial uncommitted fix**

#### Symptom
If `streamPort.postMessage()` throws (port disconnected between the `if (streamPort)` null-check and the `postMessage` call), the error propagates as an unhandled rejection. The `return;` on the next line is never reached, so `input.disabled`, `sendBtn.disabled`, and `input.focus()` are never called. **The UI is permanently stuck** — no input, no retry, no error message.

No error is surfaced to the user — the UI just becomes inert.

#### Fix (applied in working tree)
Wrap the `postMessage` call in a try-catch. On failure, reset `streamSession.active`, set `streamPort = null`, and fall through to the `chrome.runtime.sendMessage` fallback path:

```javascript
try {
  streamPort.postMessage({ /* ... */ });
} catch (e) {
  streamSession.active = false;
  streamPort = null;
}
if (streamPort) {
  return; // Response arrives via handleStreamMessage
}
// Falls through to non-streaming fallback
```

---

## 🟡 P1 DEFECTS (features degraded)

### P1-A — No `sessionId` in streaming response messages from background

**Files:** `extension/background.js` (finishStream, _askZoStreamImpl SSE handlers)  
**Status:** ❌ Remains broken

#### Symptom
The sidepanel's `handleStreamMessage` guard:
```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

...never filters STREAM_CHUNK, STREAM_DONE, or STREAM_ERROR messages because none of them carry a `sessionId` field. This means:
- Stale responses from a previous session can leak into an active session if the user sends two rapid queries
- The guard only works for ASK_ZO messages (which are sent with `sessionId` from the sidepanel)
- If Zo is slow and the user starts a new chat mid-stream, old streaming updates continue modifying the new conversation's UI

#### Fix
Include `sessionId` in all response messages from `finishStream` and `_askZoStreamImpl`:

```javascript
// In _askZoStreamImpl, at postMessage calls:
port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId: msg.sessionId });
port.postMessage({ type: 'STREAM_ERROR', error: ..., sessionId: msg.sessionId });

// In finishStream:
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId: msg.sessionId });
```

The sidepanel `handleStreamMessage` guard then correctly filters stale messages.

---

### P1-B — `streamSession.msgEl` null + `responseText` empty → "Done." even with actions

**Files:** `extension/sidepanel.js` (STREAM_DONE handler, else branch)  
**Status:** ❌ Remains broken

#### Symptom
When the Zo API returns a non-streaming JSON response (models that don't support SSE):
1. `_askZoStreamImpl` detects `content-type: application/json`
2. Parses `data.output` and calls `finishStream(port, data.output, ...)` directly
3. NO `STREAM_CHUNK` is ever sent → `streamSession.msgEl` remains null
4. `STREAM_DONE` arrives with `msg` containing `actions` with items
5. The `else` branch checks: `responseText` → empty (no done response), `msg.actions?.length` → truthy
6. Falls into the **"handled by handleStreamActions"** branch (no message shown!)
7. BUT then `handleStreamActions` is called with the actions

If the actions are of type `done` with a `response` field, `handleStreamActions` does NOTHING (the function only handles navigate and dom actions — done actions are silently ignored). So the user sees... nothing. Or the thinking indicator times out.

#### Root cause
`handleStreamActions` doesn't handle the case where actions only contain `done` types. It has an implicit assumption that done actions are always paired with navigate or dom actions.

#### Fix
In `handleStreamActions`, add a fallback for done-only actions:

```javascript
function handleStreamActions(actions, reasoning) {
  const navigateActions = actions.filter(a => a.type === 'navigate');
  const domActions = actions.filter(a => a.type !== 'navigate' && a.type !== 'done');
  const doneAction = actions.find(a => a.type === 'done');

  if (navigateActions.length) {
    // ...existing logic...
    return;
  }

  if (domActions.length) {
    // ...existing logic...
    return;
  }

  // Only done action — show it directly
  if (doneAction && doneAction.response) {
    addMessage('assistant', doneAction.response);
    return;
  }
}
```

---

### P1-C — `streamSession.active` guard in STREAM_ERROR loses context

**Files:** `extension/sidepanel.js` (STREAM_ERROR handler)  
**Status:** ❌ Remains broken

The STREAM_ERROR handler silently drops the error if `streamSession.active` is false:
```javascript
case 'STREAM_ERROR': {
  if (!streamSession.active) return;
  // ...
}
```

If the port disconnects between the error occurring and the STREAM_ERROR message arriving, the error is silently swallowed. The user sees nothing, and the input may remain disabled.

#### Fix
Remove the `streamSession.active` guard from STREAM_ERROR. Errors should always be shown:

```javascript
case 'STREAM_ERROR': {
  streamSession.active = false;
  // ...always show error...
  break;
}
```

---

### P1-D — Conversation persistence skipped for action-only responses

**Files:** `extension/sidepanel.js` (STREAM_DONE handler)  
**Status:** ❌ Remains broken

The persistence block only saves messages when `responseText` is truthy:
```javascript
if (responseText) {
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', text: responseText, ... });
  }
}
```

When Zo returns action-based responses (navigate, click, fill) without a `done` action response, the conversation is never saved. Reloading the sidepanel loses all prior Zo interactions.

#### Fix
Always persist responses, even action-only ones. Use `JSON.stringify` of the actions as fallback text:

```javascript
const persistText = responseText || (msg.actions?.length ? JSON.stringify(msg.actions) : '');
if (persistText) {
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', text: persistText, timestamp: Date.now() });
  }
}
```

---

## 🟢 P2 ISSUES (quality & polish)

### P2-A — `domActions` computed but unused in STREAM_DONE handler

**Files:** `extension/sidepanel.js`, line ~1758  
**Labels:** `dead-code`

```javascript
const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
```

This variable is never used in the STREAM_DONE handler. It was likely intended for the `handleStreamActions` call which already performs its own filtering. Remove the dead line.

### P2-B — THINKING_TIMEOUT_MS defined but never consumed by streaming path

**Files:** `extension/sidepanel.js`  
**Labels:** `unused-code`

`THINKING_TIMEOUT_MS = 60000` and `thinkingTimeout` are declared in the module scope but never used by the streaming `sendQuery` override. The original `sendQuery` function had no timeout handling either. Long-running queries may show "Zo is thinking..." indefinitely without a fallback.

### P2-C — `addSystemMessage` duplicate `safeText` calls

**Files:** `extension/sidepanel.js`  
**Labels:** `cleanup`

The uncommitted diff shows one `safeText(text)` was removed from the duplicate call:
```javascript
function addSystemMessage(text) {
  text = safeText(text);  // This was duplicated
  ...
}
```

Already fixed in working tree. No action needed.

### P2-D — SSE content extraction field chain still fragile despite widening

**Files:** `extension/background.js`  
**Labels:** `maintainability`

The content extraction chain:
```javascript
const rawContent = parsed.content || parsed.text || parsed.output || (parsed.delta?.text) || (parsed.delta?.content) || parsed.response || parsed.message || '';
```

Covers many formats but lacks a fallback that tries to stringify any remaining `parsed` object as the text. If Zo's SSE format evolves to use a new field name, content silently becomes empty.

Consider a final `JSON.stringify(parsed)` fallback to capture any response shape:

```javascript
const rawContent = parsed.content || parsed.text || parsed.output || 
  (parsed.delta?.text) || (parsed.delta?.content) || parsed.response || 
  parsed.message || (typeof parsed === 'string' ? parsed : '');
```

---

## Verified Against Test Suite

- **140 tests pass, 0 fail** (439 expect calls) — after all uncommitted fixes + new fix
- `bun test` clean
- No regressions in message-contract tests, action execution, bang commands, or manifest validation

## Priority for Next Fix Round

| Priority | Issue | Effort | Fix |
|----------|-------|--------|-----|
| P0 | A — Empty output fallback | 15 min | Add fallback text in finishStream + sidepanel |
| P0 | B — Duplicate messages on navigate | 30 min | Deconflict STREAM_DONE body update vs handleStreamActions |
| P0 | C — postMessage rejection locks UI | ✅ Fixed | try-catch in sendQuery override |
| P1 | A — Missing sessionId in response messages | 20 min | Propagate msg.sessionId to STREAM_* responses |
| P1 | B — Done-only actions silently ignored | 15 min | Add fallback in handleStreamActions |
| P1 | C — STREAM_ERROR drops with inactive session | 10 min | Remove `!streamSession.active` guard |
| P1 | D — Action-only responses not persisted | 10 min | Save actions as JSON fallback text |
| P2 | A — Dead `domActions` variable | 5 min | Remove unused line |
