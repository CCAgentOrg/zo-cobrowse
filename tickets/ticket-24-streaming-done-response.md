# Ticket #24 — Streaming & "Done." Response Fix

**Date:** 2026-07-25  
**Status:** ✅ Fixed

## Symptoms

- Extension shows "Zo is thinking..." then "Done." instead of Zo's actual response
- Extension shows "Done." when Zo returns a done action without a `response` field
- Streaming responses may silently fail (no content appears)

## Root Causes

### C1 — SSE parser SyntaxError (P0)

The `data:` line parser in `_askZoStreamImpl` had duplicate `const data` declarations in the same block scope:

```javascript
// BEFORE — SYNTAX ERROR on every data: line
if (trimmed.startsWith('data: ')) {
    const data = trimmed.slice(6).trim();   // declaration 1
    if (!data) continue;
}
if (trimmed.startsWith('data:')) {
    const data = trimmed.slice(5).trim();   // declaration 2 — OK, different block
    if (!data) continue;
    const data = trimmed.slice(6).trim();   // declaration 3 — SAME block = SyntaxError
```

The second `if` block declared `const data` twice. This caused a `SyntaxError` when the SSE parser encountered any `data:` line, crashing the streaming path entirely.

**Fix:** Replaced both `startsWith('data: ')` checks with a single regex `/^data:\s?(.*)$/`. Also added `event:` without trailing space handling.

### C2 — Non-streaming fallback shows "Done." (P1)

When Zo returned a structured response with `actions: [{type: "done"}]` but no `response` field, the fallback code displayed `'Done.'` because:
1. `doneResponse` was empty (no `response` field on the done action)
2. The code didn't fall through to `reasoning` before showing `'Done.'`

**Fix:** Changed priority to `doneResponse || reasoning || 'Done.'` in both the no-actions and done-action branches.

### C3 — End event missing output field (P2)

When Zo's SSE End event contained structured data (`reasoning`/`actions`) directly instead of wrapped in an `output` field, the event was silently dropped.

**Fix:** Added `else if (parsed.reasoning || parsed.actions) { fullText = safeText(parsed); }`.

## Files Changed

| File | Change |
|------|--------|
| `extension/background.js` | Fixed SSE parser (data: regex, event: without space, End event fallback) |
| `extension/sidepanel.js` | Fixed non-streaming fallback to use `reasoning` before `'Done.'` |

## Verification

- All 140 tests pass (0 failures)
- Git commit: `54d7de9`
