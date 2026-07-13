# #16 — Fix DuckDB/SQLite Mismatch in /api/cobrowse/query

**Source**: QA_REPORT.md B2
**Severity**: 🔴 High (runtime failure)
**Effort**: Small
**Labels**: `bug`, `phase-3`, `zo-space`

## Problem

The zo.space route `/api/cobrowse/query` imports `bun:sqlite` and opens `data.duckdb` — DuckDB binary format is incompatible with SQLite. The query will fail at runtime.

## Acceptance Criteria

- [ ] Route uses `duckdb` npm package or shells out to `duckdb` CLI
- [ ] DuckDB queries execute correctly on `.duckdb` files
- [ ] Error handling for missing database files
- [ ] Existing tests still pass
