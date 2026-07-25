# #32 — streamPort.postMessage Can Throw with No Error Handling

**Date:** 2026-07-26  
**Severity:** 🔴 P0 — Port disconnect between guard and postMessage permanently disables UI  
**Labels:** `bug`, `critical`, `stability`

## Symptom

The extension freezes — input stays disabled, no error shown. User must close and reopen the sidepanel.

## Root Cause

In `sidepanel.js` (the overridden `sendQuery`), the streaming path checks for `streamPort` existence but doesn't handle postMessage failure:

```javascript
if (!streamPort) connectStreamingPort();
if (streamPort) {
  streamSession.sessionId++;
  ...
  streamPort.postMessage({  // <-- Can throw if port disconnected
    sessionId: thisSessionId,
    type: 'ASK_ZO',
    ...
  });
  return;  // <-- Returns without error handling
}
```

If the port disconnects between the `if (streamPort)` check and the `postMessage` call (e.g., background service worker terminates), the thrown error is unhandled. `input.disabled` and `sendBtn.disabled` are never reset, and `cancelStream` is never called.

## Fix

Wrap in try/catch:

```javascript
try {
  streamPort.postMessage({...});
  return;
} catch (e) {
  console.error('Port postMessage failed:', e);
  streamPort = null;
  streamSession.active = false;
  // Fall through to the non-streaming path below
}
```

## Files

- `extension/sidepanel.js` — the overridden `sendQuery()` streaming path
