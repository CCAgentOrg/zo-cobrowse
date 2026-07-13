# #21 — Add Explicit CSP to Manifest

**Source**: QA_REPORT.md B5
**Severity**: 🟢 Low
**Effort**: Trivial
**Labels**: `bug`, `security`

## Problem

Manifest doesn't declare `content_security_policy`. MV3's default CSP is restrictive, but for an extension that loads content from user-specified pages, this should be explicitly declared to avoid surprises.

## Acceptance Criteria

- [ ] Manifest includes explicit `content_security_policy` declaration
- [ ] CSP allows loading content from user-specified origins
- [ ] Extension still loads without warnings
