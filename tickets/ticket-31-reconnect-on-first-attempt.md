# #31 — STREAM_RECONNECT Fires on First Attempt (Not a Retry)

**Status:** ⚠️ **Duplicate of #27** — see `ticket-27-false-reconnect-ui.md` (canonical). Kept for history.

**Date:** 2026-07-26  
**Severity:** 🟡 P3 — Cosmetic: sidepanel shows "Reconnecting... attempt 1 of 3" on every query  
**Labels:** `bug`, `cosmetic`

## Symptom

Every query shows a brief "➳ Reconnecting... attempt 1 of 3" banner in the sidepanel before the actual response appears. This is confusing — the query hasn't failed, it's not reconnecting.

## Root Cause

In `background.js`, `askZoStream()` sends `STREAM_RECONNECT` on EVERY attempt (including the FIRST one):

```javascript
async function askZoStream(port, msg) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) port.postMessage({ type: 'STREAM_RECONNECT_DONE' });
      port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });  // <-- ALWAYS fires
      return await _askZoStreamImpl(port, msg);
```

The first attempt is NOT a reconnection — it's the initial request. `STREAM_RECONNECT` should only be sent for `attempt > 1`.

## Fix

Move `STREAM_RECONNECT` inside the `attempt > 1` branch:

```javascript
if (attempt > 1) {
  port.postMessage({ type: 'STREAM_RECONNECT_DONE' });
  port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });
}
```

## Files

- `extension/background.js` — `askZoStream()` (line ~4-12)
