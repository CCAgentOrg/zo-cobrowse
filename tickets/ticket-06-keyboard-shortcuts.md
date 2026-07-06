# Keyboard Shortcuts

**Phase**: P2 (Everywhere, Layered)
**Priority**: 🟡 Medium
**Effort**: Small
**Labels**: `phase-2`, `priority-medium`

## Description

There are no keyboard shortcuts for Zo Co-browse. Users should be able to open the side panel, summarize a page, or start a query without touching the mouse.

## Acceptance Criteria

- [ ] `Ctrl+Shift+Z` (or `Cmd+Shift+Z` on Mac): Open Zo side panel / focus the query input
- [ ] `Ctrl+Shift+S`: Summarize the current page (sends query to Zo)
- [ ] `Ctrl+Shift+X`: Extract data from current page
- [ ] Within the side panel: `Escape` closes panel (or blurs input)
- [ ] Within the side panel: `Ctrl+Enter` sends query (in addition to Enter)
- [ ] Keyboard shortcuts are configurable in the options page
- [ ] Shortcuts registered via `chrome.commands` API in manifest
- [ ] Tests: verify commands are registered with correct key combinations

## Technical Notes

- `chrome.commands` API in MV3 requires manifest declaration:
  ```json
  "commands": {
    "_execute_action": { "suggested_key": { "default": "Ctrl+Shift+Z" } },
    "summarize-page": { "suggested_key": { "default": "Ctrl+Shift+S" } }
  }
  ```
- `_execute_action` is a reserved command name for opening the popup/side panel — use this
- Custom commands dispatch via `chrome.commands.onCommand` listener in background
- For Mac: Cmd key is used instead of Ctrl (Chrome handles this automatically with `suggested_key`)
- The `chrome.commands` API doesn't support dynamic registration; all shortcuts must be in `manifest.json`

## Files to Edit

- `extension/manifest.json` → add `"commands"` section
- `extension/background.js` → add `chrome.commands.onCommand` listener
- `extension/options.html` + `extension/options.js` → shortcut configuration UI
