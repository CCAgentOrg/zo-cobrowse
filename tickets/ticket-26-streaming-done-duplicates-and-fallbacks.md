# #26 — Streaming "Done." Display, Duplicate Messages & Non-streaming Fallback Audit

**Date:** 2026-07-26  
**Severity:** 🔴 Critical (multiple P0/P1 defects causing "Done." display, duplicate messages, stuck input)  
**Labels:** `bug`, `streaming`, `stability`, `regression`

## Summary

After tickets #23–#25 fixed the SSE parser crash and improved response handling, **3 remaining defects** still cause the extension to display "Done." instead of Zo's actual response, produce duplicate messages for navigate actions, and silently drop responses on port disconnect.

---

## 🔴 P0 — STREAM_DONE duplicates doneResponse for navigate actions

**Files:** `extension/sidepanel.js` — `handleStreamActions()` (line ~1875), `handleStreamMessage()` STREAM_DONE handler (line ~1758)  
**Status:** ❌ Unfixed

### Root cause
When Zo returns navigate actions with a `done` response, **two code paths** both add the done response text:

1. **Path A** (STREAM_DONE): Updates `streamSession.msgEl` content with `responseText` (which includes the done action's response)
2. **Path B** (`handleStreamActions`): Adds `📍 Navigating to: {url}`, then schedules a `setTimeout` that adds the doneResponse as a NEW message after 2 seconds

**Result:** The done response appears twice — once as the updated streaming message, and again after a 2-second delay.

### Sequence of events
1. Zo returns `{actions: [{type: "navigate", url: "..."}, {type: "done", response: "Here's the info"}]}`
2. STREAM_DONE handler: updates `streamSession.msgEl.innerHTML` with `"Here's the info"` 
3. STREAM_DONE handler: calls `handleStreamActions(actions)`
4. `handleStreamActions`: adds `"📍 Navigating to: ..."` as a new message
5. 2s later: setTimeout fires → adds `"Here's the info"` as a **third** message (duplicate of step 2)

### Fix
In STREAM_DONE handler, when actions exist, skip replacing the streamed message body with the done response text — let `handleStreamActions` manage the final display.

---

## 🔴 P0 — Non-streaming fallback shows "Done." when Zo returns action-only response without reasoning text

**Files:** `extension/sidepanel.js` — override `sendQuery()` fallback path (line ~2063)  
**Status:** ❌ Unfixed

### Root cause
When the non-streaming fallback path is used (port unavailable) and Zo returns actions without a top-level `reasoning` field:

```json
{
  "actions": [{"type": "done", "response": "Task complete"}]
}
```

The code:
```javascript
if (!actions.length) {
  addMessage('assistant', reasoning || doneResponse || 'Done.');
}
```

This works for action-only because `actions.length` is truthy. 

But when Zo returns:
```json
{
  "reasoning": "",
  "actions": [{"type": "done"}]
}
```

The `doneAction` is found but `doneAction.response` is undefined. So `doneResponse = ''`. And:
```javascript
if (doneAction && !hasNavigate) {
  addMessage('assistant', doneResponse || reasoning || 'Done.');
}
```

This shows "Done." because both `doneResponse` and `reasoning` are empty.

---

## 🟡 P1 — STREAM_DONE re-enables input before handleStreamActions setTimeout completes

**Files:** `extension/sidepanel.js` — STREAM_DONE handler (line ~1840), `handleStreamActions()` (line ~1885)  
**Status:** ❌ Unfixed

### Root cause
After navigate actions, `handleStreamActions` schedules a `setTimeout` that adds the doneResponse. Meanwhile, STREAM_DONE re-enables input immediately. The user can send a new query while the setTimeout is pending. If the user sends a new query and the new streaming response references the page, the page may still be loading from the navigate action.

---

## 🟡 P2 — `handleStreamActions` addedResponse race with new conversations

**Files:** `extension/sidepanel.js` — `handleStreamActions()` (line ~1886)  
**Status:** ❌ Unfixed

### Root cause
The 2-second `setTimeout` in `handleStreamActions` captures `doneResponse` by value, but `addMessage` writes to the *active* conversation. If the user starts a new conversation within those 2 seconds, the doneResponse is added to the wrong conversation.

---

## 🟢 P3 — `markdownToHtml` called inside streamed message without error wrapping

**Files:** `extension/sidepanel.js` — STREAM_CHUNK handler (line ~1744)  
**Status:** ❌ Unfixed

### Root cause
```javascript
body.innerHTML = markdownToHtml(safeText(msg.text));
```
If `markdownToHtml` throws (e.g., from a malformed regex on crafted content), the error propagates unhandled inside the message handler, potentially crashing the stream session.
