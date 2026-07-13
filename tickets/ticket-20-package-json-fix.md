# #20 — Fix package.json Script Syntax Error

**Source**: QA_REPORT.md B1
**Severity**: 🟢 Low
**Effort**: Trivial
**Labels**: `bug`, `tooling`

## Problem

The `check-icons` and `check-prereqs` scripts in `package.json` use `${s}` template literal syntax in shell for-loop commands. Bun's JSON parser rejects this.

## Acceptance Criteria

- [ ] `bun run check-icons` works without parse errors
- [ ] `bun run check-prereqs` works without parse errors
- [ ] Scripts still verify what they're meant to check
