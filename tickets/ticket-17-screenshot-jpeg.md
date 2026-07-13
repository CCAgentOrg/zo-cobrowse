# #17 — Screenshot Capture to JPEG for Smaller Payloads

**Source**: QA_REPORT.md B3
**Severity**: 🟡 Medium (performance)
**Effort**: Small
**Labels**: `bug`, `phase-2`

## Problem

`chrome.tabs.captureVisibleTab()` defaults to PNG format, producing ~5× larger payloads than JPEG at quality 70.

## Acceptance Criteria

- [ ] `getActiveTabContext()` passes `{ format: "jpeg", quality: 70 }` to `captureVisibleTab()`
- [ ] Screenshot toggle in options still works
- [ ] Existing tests pass
