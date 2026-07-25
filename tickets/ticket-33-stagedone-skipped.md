# #33 — STREAM_DONE Skipped When streamSession.active Becomes False Mid-Stream

**Date:** 2026-07-26  
**Severity:** 🔴 P0 — Primary cause of "Done." when port disconnects mid-stream  
**Labels:** `bug`, `critical`, `streaming`, `stability`

## Symptom

User sees SSE events in console (Zo API is responding), but sidepanel shows "Done." or the response never appears. The thinking indicator disappears and "Done." appears, or the thinking indicator stays forever.

## Root Cause

The `STREAM_DONE` handler in `sidepanel.js` has a guard that silently drops the response if `streamSession.active` is false:

```javascript
case 'STREAM_DONE': {
  ...
  if (!streamSession.active) return;  // <-- Silent drop
  ...
  streamSession.active = false;
```

`streamSession.active` can become false between `sendQuery` (where it's set to true) and `STREAM_DONE` in several ways:
1. **Port disconnect handler**: When background SW terminates (MV3 idle timeout), the port disconnects and `onDisconnect` sets `streamSession.active = false` (with the uncommitted fix in the working tree)
2. **cancelStream()**: If the user starts a new conversation while streaming is in progress
3. **Rapid second query**: A second query increments `streamSession.sessionId` but `active` stays true... Actually it stays true, not false. But STREAM_DONE from the first session's content would be stale.

**The critical race condition**: In MV3, the background service worker can be terminated after ~30s of inactivity. If Zo takes longer than ~30s to respond:
1. SW terminates → port disconnects → `onDisconnect` fires → `streamSession.active = false`
2. When SW restarts (triggered by new port), the streaming connection is lost
3. The response never arrives → sidepanel shows thinking indicator forever

Even without the SW termination race, the port can disconnect if:
- The extension is reloaded
- The user navigates to a restricted page (chrome://, chrome-extension://)
- Chrome decides to evict the background page

## Fix

**Fix 1: Re-enable streaming on reconnection** (addresses immediate "Done." issue)

In the overridden `sendQuery`, if `streamPort` is null, reconnect before giving up:

```javascript
if (!streamPort || !streamPort.onMessage) {
  connectStreamingPort();
}
if (streamPort) {
  ...
}
```

**Fix 2: Remove stale STREAM_DONE guard or add better session tracking** (addresses silent drop)

The guard `if (!streamSession.active) return;` in STREAM_DONE should not be a total silent drop. Instead, process the response regardless of `active` state — the sessionId check is the correct mechanism for filtering stale messages:

```javascript
case 'STREAM_DONE': {
  // Always remove thinking indicator
  const staleThinking = msgsEl.querySelector('.msg-thinking');
  if (staleThinking) staleThinking.remove();
  
  // Process even if active is false — sessionId is the correct guard
  // (but only if we also add sessionId to STREAM_DONE — see ticket #30)
  ...
```

**Fix 3: Add a keepalive/heartbeat** for long-running streaming sessions

Send periodic heartbeats from background to sidepanel to keep the SW alive and detect disconnects early. Chrome's MV3 allows extending the SW lifetime as long as there's an active fetch + stream read loop.

**Fix 4: Reconnect and re-query** if the stream was interrupted

If `sendQuery` detects that the last stream was interrupted (no STREAM_DONE received within a timeout), automatically reconnect and retry the query.

## Files

- `extension/sidepanel.js` — `handleStreamMessage` STREAM_DONE handler, overridden `sendQuery`
