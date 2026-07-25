# #36 — Unhandled streamPort.postMessage Error Leaves UI Stuck

**Date:** 2026-07-26  
**Severity:** 🔴 P1 — If port disconnects between availability check and postMessage, UI freezes  
**Labels:** `bug`, `critical`, `error-handling`

## Symptom

User clicks "Ask Zo" and the input + send button become permanently disabled. The "Zo is thinking..." indicator stays forever. No error is shown. Only reloading the extension fixes it.

## Root Cause

In the overridden `sendQuery`, the streaming path has no error handling:

```javascript
if (streamPort) {
    streamSession.sessionId++;
    const thisSessionId = streamSession.sessionId;
    streamSession.active = true;
    streamSession.msgEl = null;
    streamSession.fullText = '';
    streamPort.postMessage({    // <-- Can throw if port is disconnected
      sessionId: thisSessionId,
      type: 'ASK_ZO',
      ...
    });
    return;   // <-- Returns without resetting input state
}
```

If `streamPort.postMessage()` throws (port disconnected but `streamPort` variable still holds a reference), the error propagates up uncaught. The `input.disabled = false` lines at the bottom of the function are never reached because of the early `return`.

Race condition: The port onDisconnect handler sets `streamPort = null`, but there's a window between the `if (streamPort)` check and the `postMessage` call where the disconnection can happen.

## Fix

Wrap the `postMessage` call in try/catch, and fall through to the non-streaming path on failure:

```javascript
if (streamPort) {
    streamSession.sessionId++;
    const thisSessionId = streamSession.sessionId;
    streamSession.active = true;
    streamSession.msgEl = null;
    streamSession.fullText = '';
    try {
      streamPort.postMessage({
        sessionId: thisSessionId,
        type: 'ASK_ZO',
        ...
      });
      return;
    } catch (e) {
      // Port disconnected — reset state and fall through
      streamPort = null;
      streamSession.active = false;
      console.warn('Stream port disconnected, falling back to one-shot:', e.message);
    }
}
// If we reach here, port wasn't available or disconnected — use one-shot
```

## Files

- `extension/sidepanel.js` — overridden `sendQuery()` streaming path
