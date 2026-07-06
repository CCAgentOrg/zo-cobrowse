# Right-Click Context Menu

**Phase**: P2 (Everywhere, Layered)
**Priority**: 🔴 High
**Effort**: Small
**Labels**: `phase-2`, `priority-high`

## Description

Zo should be accessible from right-click context menus. Currently you have to open the side panel and type — no quick paths. Add "Ask Zo about this", "Summarize with Zo", "Extract links → Zo", and "Save to research" actions to Chrome's right-click menu.

## Acceptance Criteria

- [ ] Right-click on page shows "Ask Zo about this page" → opens side panel with pre-filled query
- [ ] Right-click on selected text shows "Ask Zo about selection" → sends selected text as query
- [ ] Right-click on link shows "Ask Zo about this link" → Zo navigates to and summarizes the link
- [ ] Right-click menu items created on install/update via `chrome.contextMenus.create` in background service worker
- [ ] Context menu items respond to `chrome.contextMenus.onClicked` and dispatch appropriate messages
- [ ] Menu items are properly cleaned up on extension update via `chrome.runtime.onInstalled`
- [ ] Tests: verify context menu items are created with correct IDs and titles

## Technical Notes

- Context menus work from the background service worker (no content script needed)
- `chrome.contextMenus` API is MV3 compatible
- For "Ask Zo about selection": the content script sends `mouseup` event with selected text, or background can use `contextMenus.onClicked` which provides `selectionText`
- For link context: `onClicked` provides `linkUrl` — Zo can navigate there
- Configurable via options page — user can enable/disable individual menu items

## Files to Edit

- `extension/background.js` → add `chrome.contextMenus.create()` in `onInstalled`, add `onClicked` handler
- `extension/manifest.json` → add `"contextMenus"` permission
- `extension/options.html` + `extension/options.js` → toggle individual menu items
