# #34 — Response Messages Missing sessionId (Stale Session Leak)

**Status:** ⚠️ **Duplicate of #30** — see `ticket-30-missing-sessionid.md` (canonical). Kept for history.

**Date:** 2026-07-26  
**Severity:** 🔴 P1 — Stale responses from previous sessions can corrupt active UI  
**Labels:** `bug`, `protocol`, `data-race`

## Symptom

When sending two queries in quick succession, the first query's response can corrupt the second query's display. Actions from the wrong session may execute on the wrong page context.

## Root Cause

The sidepanel's stale-message guard checks for `sessionId`:

```javascript
function handleStreamMessage(msg) {
  if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

But the background sends `sessionId` ONLY on the initial `ASK_ZO` request, NOT on `STREAM_CHUNK`, `STREAM_DONE`, or `STREAM_ERROR` response messages.

Trace:
1. Sidepanel sends `ASK_ZO` with `sessionId: 1` → background starts processing
2. Background sends `STREAM_CHUNK` (NO sessionId) → sidepanel accepts even if session has moved to session 2
3. Background sends `STREAM_DONE` (NO sessionId) → same issue

The guard `msg.sessionId &&` means `undefined &&` = `false` → **every message passes the guard**.

## Fix

Include the sessionId in all response messages from background. The easiest approach is to store it on the port object itself:

**In background.js (port handler):**
```javascript
case 'ASK_ZO': {
  try {
    port.sessionId = msg.sessionId;  // Store on port
    await askZoStream(port, msg);
  } catch (err) {
    ...
  }
  break;
}
```

**In `_askZoStreamImpl`, `finishStream` etc. — include `port.sessionId`:**
```javascript
port.postMessage({ type: 'STREAM_CHUNK', text: fullText, sessionId: port.sessionId });
port.postMessage({ type: 'STREAM_DONE', reasoning, actions, fullText, sessionId: port.sessionId });
```

## Files

- `extension/background.js` — port handlers, `_askZoStreamImpl`, `finishStream`
- `extension/sidepanel.js` — `handleStreamMessage`
