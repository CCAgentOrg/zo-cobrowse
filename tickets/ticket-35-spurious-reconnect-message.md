# #35 — askZoStream Sends STREAM_RECONNECT on First Attempt

**Status:** ⚠️ **Duplicate of #27** — see `ticket-27-false-reconnect-ui.md` (canonical). Kept for history.

**Date:** 2026-07-26  
**Severity:** 🟡 P2 — User-visible cosmetic bug, confuses users  
**Labels:** `bug`, `ui`, `cosmetic`

## Symptom

Every query shows "➳ Reconnecting... attempt 1 of 3" in the sidepanel briefly before the response arrives. This is incorrect — there was no reconnection, it's the first attempt.

## Root Cause

In `background.js`, `askZoStream()` unconditionally sends `STREAM_RECONNECT` on every attempt including the first:

```javascript
async function askZoStream(port, msg) {
  const maxRetries = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) port.postMessage({ type: 'STREAM_RECONNECT_DONE' });
      port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });  // <-- BUG: also on attempt 1
      return await _askZoStreamImpl(port, msg);
    } catch (err) {
      lastError = err;
      ...
    }
  }
  throw lastError;
}
```

The `STREAM_RECONNECT` line should only fire on `attempt > 1`, inside the existing `if` block.

## Fix

Move the `STREAM_RECONNECT` inside the `if (attempt > 1)` block:

```javascript
if (attempt > 1) {
  port.postMessage({ type: 'STREAM_RECONNECT_DONE' });
  port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });
}
// Remove the unconditional STREAM_RECONNECT below
```

## Files

- `extension/background.js` — `askZoStream()` function (lines ~1-16)
