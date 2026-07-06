# Quick Command Templates

**Phase**: P2 (Everywhere, Layered)
**Priority**: 🟡 Medium
**Effort**: Small
**Labels**: `phase-2`, `priority-medium`

## Description

Users type free-form queries to Zo. For common tasks, there should be command templates: `!summarize`, `!extract table`, `!fill form`, `!research`, `!save`. These dispatch pre-crafted prompts that produce better, more predictable results than ad-hoc queries.

## Acceptance Criteria

- [ ] Commands recognized in the query input when starting with `!`
- [ ] `!summarize` — sends a prompt to Zo to produce a 3-5 bullet summary
- [ ] `!extract [type]` — extracts specific data (table, links, contacts, prices)
- [ ] `!fill` — identifies and fills all form fields with test/relevant data
- [ ] `!save [filename]` — saves page content to Zo workspace as markdown
- [ ] `!research [topic]` — deep research mode on the page
- [ ] Unknown commands show a helpful list of available commands
- [ ] Command templates are user-editable in the options page (extend/modify)
- [ ] Tests: verify proper command dispatch and error handling

## Technical Notes

- Command parsing happens in `sidepanel.js` `sendQuery()` — if input starts with `!`, dispatch the corresponding prompt
- Each command maps to a pre-built prompt in the `presetSystemPrompt`/`presetInstructions` format already supported
- Could be implemented as a special case of the presets system — `!` commands are just quick presets
- The `!help` command should list all available commands inline

## Files to Edit

- `extension/sidepanel.js` → command parser in `sendQuery()`, command definitions
- `extension/options.html` + `extension/options.js` → command template editor
