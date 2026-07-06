# Save Page to Zo Workspace

**Phase**: P3 (Zoverignty — Browser as Zo Terminal)
**Priority**: 🟡 Medium
**Effort**: Small
**Labels**: `phase-3`, `priority-medium`

## Description

Users should be able to save page content directly to Zo's workspace files with one click: "Save this as a research note", "Save this table as CSV", "Save these links to my dataset". This bridges web browsing with Zo's file system.

## Acceptance Criteria

- [ ] Right-click option or panel button: "Save to research" — saves page content as markdown to `Documents/research/`
- [ ] User can specify filename or auto-generate from page title
- [ ] `!save [filename]` command saves current page as markdown
- [ ] "Save selection as note" — saves highlighted text with page attribution
- [ ] Saved files are confirmed with filename and path shown in panel
- [ ] Optionally: "Save table to dataset" — extracts table and appends to DuckDB dataset
- [ ] Tests: verify save flow, filename generation, error handling

## Technical Notes

- Save actions work by prompting Zo to write to workspace files
- Zo has full file write access — the prompt asks Zo to save content
- Example: "Save the following page content to my research notes as `Documents/research/{title}.md`: [content]"
- For table extraction: Zo can extract structured data and save to CSV or DuckDB

## Files to Edit

- `extension/sidepanel.js` → save command, save button, filename dialog
- `extension/background.js` → save message handler
