# #29 — STREAM_CHUNK Content Extraction May Fail for Unknown SSE Formats

**Date:** 2026-07-26  
**Severity:** 🟡 P2 — Response text lost, "Done." shown when model uses unexpected SSE field  
**Labels:** `bug`, `streaming`, `resilience`

## Symptom

Model responds correctly (visible in network tab/console) but sidepanel shows "Done." with no text content. STREAM_CHUNK events arrive but `fullText` stays empty.

## Root Cause

`_askZoStreamImpl` in `background.js` extracts content from SSE `FrontendModelResponse` events using a fixed set of fields:

```javascript
const rawContent = parsed.content || parsed.text || (parsed.delta?.text) || (parsed.delta?.content) || parsed.response || '';
```

If the Zo API or a model provider uses a field not in this list (e.g., `parsed.output`, `parsed.message.content`, `parsed.choices[0].delta.content`), the content is silently lost and `fullText` stays `''`.

The End event handler also only looks at `parsed.output`:
```javascript
if (parsed.output) {
  fullText = safeText(parsed.output);
} else if (parsed.reasoning || parsed.actions) {
  fullText = safeText(parsed);
}
```

If the End event has neither `output` nor structured data, `fullText` remains whatever was accumulated (likely `''`).

## Fix

1. Add SSE format logging (console.debug) on first chunk to aid debugging
2. Fall back to `JSON.stringify(parsed)` if all known content fields are empty
3. Add a final content check in `finishStream`: if `output` is empty and we have `fullText`, try the reverse — if the model returned markdown text, use it directly before defaulting to "Done."
4. At the sidepanel level, add one more fallback: if `responseText` is empty but `streamSession.fullText` has content, use it

## Files

- `extension/background.js` — `_askZoStreamImpl`, `finishStream`
- `extension/sidepanel.js` — `handleStreamMessage` STREAM_DONE handler
