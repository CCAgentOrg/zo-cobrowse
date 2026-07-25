# #30 — Session ID Not Passed in STREAM_CHUNK / STREAM_DONE / STREAM_ERROR

**Date:** 2026-07-26  
**Severity:** 🔴 P1 — Cross-session message contamination, stale responses corrupt active session  
**Labels:** `bug`, `streaming`, `stability`

## Symptom

If a user sends multiple queries in quick succession (before the first completes), responses from different sessions mix together. STREAM_CHUNK content from session 1 may appear in session 2's response, or an old STREAM_DONE from session 1 may close session 2 prematurely.

## Root Cause

`_askZoStreamImpl` in `background.js` sends `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages **without** the `sessionId` field:

```javascript
port.postMessage({ type: 'STREAM_CHUNK', text: fullText });
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText });
port.postMessage({ type: 'STREAM_ERROR', error: '...' });
```

The sidepanel's `handleStreamMessage` guard tries to filter stale messages:

```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

But since `msg.sessionId` is `undefined`, the guard is **always** false — every message passes through regardless of which session it belongs to.

Meanwhile, the `ASK_ZO` message sent from sidepanel DOES include sessionId:

```javascript
streamPort.postMessage({
  sessionId: thisSessionId,
  type: 'ASK_ZO',
  ...
});
```

So the request is scoped to a session, but the response is not.

## Fix

Pass `sessionId` in every outbound message from `_askZoStreamImpl`:

```javascript
// In background.js _askZoStreamImpl, extract sessionId from msg
const { sessionId, ... } = msg;

// Then in all postMessage calls:
port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId });
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId });
port.postMessage({ type: 'STREAM_ERROR', error: '...', sessionId });
```

Also pass `sessionId` in `finishStream()`.

This ensures sidepanel correctly filters out stale messages from previous sessions.

## Files

- `extension/background.js` — `_askZoStreamImpl`, `finishStream`, port.onMessage handler
