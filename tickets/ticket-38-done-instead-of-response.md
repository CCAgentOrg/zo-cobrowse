# #38 — "Done." Shown Instead of Zo Response Despite Working Network

**Date:** 2026-07-26  
**Severity:** 🔴 P0 — Core feature broken, extension shows "Done." for every query  
**Labels:** `bug`, `blocker`, `streaming`, `response`

## Symptom

"Eventstream visible in console, but sidepanel still shows 'Done.'" — the Zo API responds correctly, network events arrive, but the sidepanel's output shows "Done." with no actual response text.

## Root Causes

Four independent bugs can produce the same "Done." symptom. The first is the most likely:

### C1 — SSE chunk content field doesn't match Zo API output (P0)

The Zo API SSE `FrontendModelResponse` events may use a different data format than what the parser expects. Current parser checks in order:

```javascript
parsed.content || parsed.text || parsed.delta?.text || parsed.delta?.content || parsed.response
```

**If the Zo API sends content in a field not listed here** (e.g., `parsed.output` for each chunk, or just the raw string without `content` key), every chunk produces empty content, `fullText` stays `''`, and the End event passes empty to `finishStream`, which returns empty reasoning/actions — and "Done." is displayed.

**Fix**: Log the actual Zo SSE data format at runtime, then add the missing field to the extraction chain. Example:

```javascript
// Debug: log actual chunk data
console.debug('SSE chunk:', parsed);
```

Additionally, add a catch-all fallback when no known format matches:

```javascript
const rawContent = parsed.content || parsed.text || ... || parsed.output || JSON.stringify(parsed);
```

### C2 — Non-streaming model returns empty output (P1)

When the selected model doesn't support streaming, Zo's API returns a plain JSON response (detected by `content-type: application/json`). The code calls:

```javascript
finishStream(port, data.output || '', resolvedIntent);
```

If `data.output` is `undefined`, `null`, or `""`, the entire response is an empty string. `finishStream` produces empty reasoning/actions/fullText, and the sidepanel shows "Done."

**Fix**: Add a fallback in the JSON content-type handler — if `data.output` is empty/falsy, try `JSON.stringify(data)` or log a warning:

```javascript
const output = data.output || '';
if (!output) {
  console.warn('Zo API returned empty output:', JSON.stringify(data));
}
finishStream(port, output, resolvedIntent);
```

### C3 — `streamSession.active` reset by port disconnect before STREAM_DONE (P1)

If the background service worker restarts between the `port.postMessage` and the response, the port disconnects and its `onDisconnect` handler sets `streamSession.active = false`. When STREAM_DONE arrives (if it arrives at all — the port is dead by then), the handler at line ~1764 returns early:

```javascript
if (!streamSession.active) return;  // <-- Response silently dropped
```

**Fix**: See ticket #37 for SW lifetime handling. Additionally, the STREAM_DONE handler should not silently return — it should attempt the fallback path even when `!streamSession.active`:

```javascript
if (!streamSession.active) {
  // Attempt to display anyway — stale response possible but better than silent drop
  if (msg.fullText || msg.reasoning) {
    addMessage('assistant', msg.fullText || msg.reasoning || 'Done.');
  }
  return;
}
```

### C4 — STREAM_CHUNK skipped because `streamSession.active` was false, leaving `msgEl` null (P1)

If `streamSession.active` is false when the first STREAM_CHUNK arrives, the chunk handler quietly returns:

```javascript
case 'STREAM_CHUNK': {
  if (!streamSession.active) return;  // <-- Chunk dropped
```

This leaves `streamSession.msgEl = null`. When STREAM_DONE arrives, there's no existing message element. If `responseText` is also empty, "Done." is shown instead of the content.

The fix from C3 (fallback display) also resolves this.

## Diagnostic Steps

1. Open the background service worker console and look for:
   - `console.debug` output showing actual Zo SSE data format
   - Network errors or empty responses
2. Test with a model known to support streaming (e.g., Anthropic Claude models)
3. Check `content-type` header of the Zo API response for the user's selected model

## Files

- `extension/background.js` — `_askZoStreamImpl()` SSE parsing (lines ~820-910), `finishStream()` (lines ~922-949)
- `extension/sidepanel.js` — `handleStreamMessage()` STREAM_DONE handler (lines ~1758-1830), STREAM_CHUNK handler (lines ~1738-1756)
