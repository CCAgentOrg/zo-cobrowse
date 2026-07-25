# #37 — MV3 Service Worker Termination Kills Active Streams

**Date:** 2026-07-26  
**Severity:** 🔴 P1 — Long streaming responses can be silently truncated  
**Labels:** `bug`, `mv3`, `stability`

## Symptom

For long-running Zo queries (complex research, multi-turn conversations), the background service worker may terminate before the SSE stream completes. The sidepanel shows "Zo is thinking..." indefinitely or eventually shows "Done." with no content.

## Root Cause

Chrome MV3 service workers have a 30-second idle timeout and ~5-minute event lifetime. The `_askZoStreamImpl` function runs a long-lived `fetch` + SSE read loop via the `stream: true` API. If the SW is terminated:
1. The SSE reader loop dies
2. The port disconnects on the sidepanel side
3. The sidepanel's `onDisconnect` handler cleans up (`streamSession.active = false`)
4. User sees no response — query is lost

The existing `askZoStream()` retry mechanism (3 retries, exponential backoff) only handles network-level fetch failures, not SW termination.

## Mitigation

Several options, in order of recommendation:

### Option A: Keep SW alive during streaming (recommended)

Use `chrome.runtime.connect()` to maintain a keepalive port. MV3 gives extensions with active connections a longer lifetime (up to 5 minutes from last activity). Create a separate internal port that pings periodically.

### Option B: Timeout-aware query with session recovery

Set a timeout on the streaming response (e.g., 4 minutes) and on timeout, fall back to non-streaming `askZo()` which completes as a single fetch within the SW's event-processing window:

```javascript
const streamResult = await race(
  streamResponse,        // Try streaming first
  timeout(240000)        // 4 minute timeout
);
if (streamResult === 'timeout') {
  // Fall back to non-streaming
  const data = await fetch(config.zoApiUrl, {
    ...same params without stream: true...
  });
}
```

### Option C: Show warning for long responses

Detect when a response is taking >30s and show a "This query is taking longer than expected..." message with an option to switch to non-streaming.

## Files

- `extension/background.js` — `_askZoStreamImpl()`, `askZoStream()`, `askZo()`
- `extension/sidepanel.js` — `handleStreamMessage`

## Priority

This is a known MV3 limitation. File it but consider it a "day one constraint" for Chrome extensions. The Zo desktop app doesn't have this limitation because it runs as a persistent background process.
