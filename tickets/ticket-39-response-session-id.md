# #39 — Missing sessionId in Response Messages Causes Cross-Session Leakage

**Status:** ⚠️ **Duplicate of #30** — see `ticket-30-missing-sessionid.md` (canonical). Kept for history.

**Date:** 2026-07-26  
**Severity:** 🟡 P2 — Rapid queries mix responses across sessions  
**Labels:** `bug`, `streaming`, `state-management`

## Symptom

When the user sends multiple queries in quick succession (before the first response finishes), responses from the first query affect the second query's output. The sidepanel may show garbled or mixed text.

## Root Cause

The sidepanel tracks sessions with `streamSession.sessionId`. Each new query increments the ID, and the `handleStreamMessage` guard filters stale messages:

```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

**However**, background.js never includes `sessionId` in its response messages:

| Message Type | Has `sessionId`? |
|---|---|
| `STREAM_CHUNK` | ❌ |
| `STREAM_DONE` | ❌ |
| `STREAM_ERROR` | ❌ |
| `STREAM_RECONNECT` | ❌ |
| `STREAM_RECONNECT_DONE` | ❌ |

Since `msg.sessionId` is `undefined` (falsy), the guard always passes. This means:
- If session 1 is still streaming and the user sends session 2
- Session 1's STREAM_CHUNK/DONE messages are accepted and processed by the session 2 handler
- Text gets mixed, "Done." can be shown prematurely when session 1's STREAM_DONE sets `streamSession.active = false` before session 2's content arrives

## Fix

Include `sessionId` in ALL response messages from background.js. The `msg` object received by the port's onMessage handler already has `sessionId` from the ASK_ZO message. Pass it through:

```javascript
// In askZoStream / _askZoStreamImpl:
function askZoStream(port, msg) {
  const sessionId = msg.sessionId;  // Capture from the incoming message
  // Pass to _askZoStreamImpl
  return _askZoStreamImpl(port, msg, sessionId);
}

// In _askZoStreamImpl:
function _askZoStreamImpl(port, msg, sessionId) {
  // ... inside the loop:
  port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId });
  // ... in finishStream:
  port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId });
  // ... error:
  port.postMessage({ type: 'STREAM_ERROR', error: '...', sessionId });
}
```

This ensures the sidepanel's guard correctly filters messages belonging to the current session only.

## Files

- `extension/background.js` — `askZoStream()`, `_askZoStreamImpl()`, `finishStream()`
- `extension/sidepanel.js` — `handleStreamMessage()`
