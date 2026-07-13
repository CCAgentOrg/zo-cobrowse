# #18 — Stream Reconnection with Exponential Backoff

**Source**: QA_REPORT.md B4
**Severity**: 🟡 Medium (UX)
**Effort**: Medium
**Labels**: `bug`, `phase-2`

## Problem

If the SSE connection to `/zo/ask` drops mid-stream, there's no retry. The user sees a truncated response with no error or reconnect attempt.

## Acceptance Criteria

- [ ] Add retry logic with exponential backoff (1-2 retries)
- [ ] Surface a clear error message to user if stream permanently fails
- [ ] Don't duplicate already-received content on reconnect
- [ ] Existing tests pass
