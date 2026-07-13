# #22 — Expand Test Coverage

**Source**: QA_REPORT.md — Missing Test Coverage section
**Severity**: 🟡 Medium (quality)
**Effort**: Large
**Labels**: `testing`, `quality`

## Problem

Several critical code paths have no test coverage:

- Error handling (API errors, network failures, invalid config)
- Streaming (SSE parsing, chunk assembly, stream completion)
- Action execution (`executeActions()`: navigate, click, fill, extract, scroll)
- Screenshot capture (`getActiveTabContext()`, fallback behavior)
- DuckDB queries (`runDuckdbQuery()`)
- Automation creation (`createAutomation()`, `listAutomations()`)
- Settings persistence (save/load behavior, not just field existence)
- HTML interactions (runtime click, toggle, etc.)

## Approach

Add tests incrementally, start with areas that have the highest risk of regression:

- [ ] Streaming: SSE parsing + chunk assembly + completion signal
- [ ] Error handling: mock API errors, network failures, invalid config
- [ ] Action execution: unit test the DOM action functions
- [ ] Settings: save/load roundtrip tests
- [ ] DuckDB: mock response tests
