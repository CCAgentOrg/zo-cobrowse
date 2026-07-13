# #19 — API Auth Hardening for zo.space Routes

**Source**: QA_REPORT.md B6
**Severity**: 🟡 Medium (security)
**Effort**: Small
**Labels**: `bug`, `security`, `zo-space`

## Problem

The zo.space API routes `/api/cobrowse/query` and `/api/cobrowse/research` have conditional auth: if `CO_BROWSE_SECRET` env var is not set, auth is entirely skipped.

## Acceptance Criteria

- [ ] Auth is required when the extension is public-facing
- [ ] Document CO_BROWSE_SECRET setup in the extension README
- [ ] Both routes return 401 when no valid token is provided
