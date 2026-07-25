# #27 — askZoStream Sends False "Reconnecting" UI on First Attempt

**Date:** 2026-07-26  
**Severity:** 🟡 P2 — Misleading UI, no data loss  
**Labels:** `bug`, `streaming`, `ux`

## Symptom

Every query shows a brief "➳ Reconnecting... attempt 1 of 3" banner in the sidepanel before the actual response appears.

## Root Cause

`askZoStream()` in `background.js` (line 1-16) sends `STREAM_RECONNECT` on **every** attempt including the first:

```javascript
if (attempt > 1) port.postMessage({ type: 'STREAM_RECONNECT_DONE' });
port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });  // Always sends!
return await _askZoStreamImpl(port, msg);
```

The `STREAM_RECONNECT` message should only be sent when `attempt > 1` (actual retries). On the first attempt, no reconnection UI should appear.

## Fix

Move the `port.postMessage({ type: 'STREAM_RECONNECT' })` inside the `if (attempt > 1)` block with the `STREAM_RECONNECT_DONE` message:

```javascript
if (attempt > 1) {
  port.postMessage({ type: 'STREAM_RECONNECT_DONE' });
  port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });
}
```

## Files

- `extension/background.js` — `askZoStream()` function
