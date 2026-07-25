# #28 — Unhandled `streamPort.postMessage` Exception Locks UI

**Date:** 2026-07-26  
**Severity:** 🔴 P0 — Sidepanel permanently stuck if port disconnects mid-send  
**Labels:** `bug`, `streaming`, `stability`

## Symptom

If the streaming port disconnects between the `if (streamPort)` check and the `streamPort.postMessage()` call:
- The exception propagates as an uncaught error
- `input.disabled` and `sendBtn.disabled` are never set back to `false`
- Sidepanel is permanently stuck with disabled inputs
- User must reload the extension to recover

## Root Cause

The override `sendQuery` in `sidepanel.js` (line ~1977-1996) does:

```javascript
if (streamPort) {
  streamSession.active = true;
  streamPort.postMessage({...});  // Can throw if port disconnected
  return;  // Inputs never re-enabled
}
```

There is no `try/catch` around the `postMessage` call. The port can disconnect between the guard check and the send due to:
- MV3 service worker terminating
- Extension reloaded
- Lazy port cleanup (port set to null immediately, but the variable could be stale)

## Fix

Wrap the port send in a `try/catch`. On failure, fall through to the `chrome.runtime.sendMessage` path:

```javascript
if (streamPort) {
  try {
    streamSession.active = true;
    streamSession.msgEl = null;
    streamSession.fullText = '';
    streamPort.postMessage({...});
    return;
  } catch {
    streamPort = null;  // Mark port as dead
    // Fall through to non-streaming path
  }
}
```

## Files

- `extension/sidepanel.js` — `sendQuery` override (streaming path)
