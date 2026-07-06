# Natural Language → DuckDB Queries

**Phase**: P3 (Zoverignty — Browser as Zo Terminal)
**Priority**: 🔴 High
**Effort**: Medium
**Labels**: `phase-3`, `priority-high`

## Description

Zo's unique advantage is direct access to DuckDB datasets. The side panel should support natural language queries that get translated to DuckDB SQL and executed against Zo's datasets. This is the killer feature no competitor has.

## Acceptance Criteria

- [ ] User can type queries like "How many Wikipedia DYK entries from 2025 mention Tamil Nadu?" in the panel
- [ ] Zo translates the query to SQL, runs it against the relevant dataset, and returns results
- [ ] Results are displayed in the side panel as a formatted table
- [ ] The zo.space query API endpoint (`/api/cobrowse/query`) is called for read-only DuckDB queries
- [ ] Error handling: if Zo can't determine the dataset or the query fails, show a clear error
- [ ] Optionally: results can be exported as CSV from the panel
- [ ] Tests: verify query dispatch and result display

## Technical Notes

- The endpoint `/api/cobrowse/query` already exists on zo.space — use it as the query proxy
- Consider caching recent query results locally
- DuckDB queries are read-only — no risk of data modification
- The `CO_BROWSE_SECRET` env var is used for auth between extension and zo.space
- For the panel: results table rendering with scroll support for large datasets

## Files to Edit

- `extension/sidepanel.js` → query input mode, result table rendering
- `extension/background.js` → duckdb query message handler
- `extension/sidepanel.html` → query mode UI, export button
- `extension/styles.css` → table styles
