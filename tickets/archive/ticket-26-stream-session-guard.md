# #26 — Streaming Session State Leak: STREAM_DONE Dropped When Port Disconnects

**Date:** 2026-07-26  
**Severity:** 🔴 P0 — No responses shown in sidepanel  
**Labels:** `bug`, `streaming`, `stability`, `regression`

## Symptom

1. User types a query in the sidepanel
2. "Zo is thinking..." appears
3. Event stream IS visible in console (STREAM_CHUNK events arriving)
4. Sidepanel shows "Done." or blank instead of the actual response

## Root Cause

### C1 — `streamSession.active` guard drops STREAM_DONE after port disconnect

`handleStreamMessage()` for `STREAM_DONE` (sidepanel.js ~1764) has:

```javascript
if (!streamSession.active) return;
```

The port `onDisconnect` handler sets `streamSession.active = false`. In MV3, the background service worker can terminate between the time the query is sent and the response arrives, which disconnects the port. When the service worker restarts to finish the fetch, the response events arrive but `streamSession.active` is `false`, so they're silently dropped.

**Uncommitted fix attempt** added disconnect cleanup but that's counterproductive — it sets `streamSession.active = false` in the disconnect handler, which then causes the STREAM_DONE to be dropped.

### C2 — Response messages lack `sessionId` guard field

`STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages sent from `background.js` do not include a `sessionId` field. The session guard in `handleStreamMessage` is:

```javascript
if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
```

Since `msg.sessionId` is `undefined` for all response messages, the guard is always skipped. This means:
- Stale responses from a previous conversation session leak into the current one
- Rapid successive queries mix up responses across sessions

### C3 — Non-streaming fallback shows "Done." on empty Zo response

When the streaming port is unavailable (`!streamPort`), the code falls back to `chrome.runtime.sendMessage({type: 'ASK_ZO'})`. If the Zo API returns `{output: ""}` or `{output: undefined}`, `reasoning` and `actions` are both empty, leading to `addMessage('assistant', reasoning || doneResponse || 'Done.')` displaying "Done."

## Fix

1. Remove `streamSession.active = false` from port `onDisconnect` handler — the STREAM_DONE/STREAM_ERROR handlers are the only ones that should conclude a session
2. Add `sessionId` to `STREAM_CHUNK`, `STREAM_DONE`, and `STREAM_ERROR` messages in `background.js`
3. Keep `streamSession.active` guard but wrap it properly — only skip if `msg.sessionId` is set AND mismatched
4. Add empty-output fallback in non-streaming path: never show "Done." when the API returned any text

## Files

- `extension/background.js` — `_askZoStreamImpl`, `finishStream`
- `extension/sidepanel.js` — `handleStreamMessage`, port `onDisconnect`, non-streaming fallback

## Test Notes

- Add test: port disconnect mid-stream → STREAM_DONE still displays response
- Add test: rapid successive queries don't mix responses
- Add test: Zo returns empty output → shows message, not "Done."
