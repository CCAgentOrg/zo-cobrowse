# Omnibox Commands

**Phase**: P2 (Everywhere, Layered)
**Priority**: 🟡 Medium
**Effort**: Small
**Labels**: `phase-2`, `priority-medium`

## Description

Users should be able to type `zo ` in Chrome's address bar (omnibox) followed by a query to interact with Zo without opening the side panel. This is a keyboard-friendly surface for quick actions.

## Acceptance Criteria

- [ ] Typing `zo ` in the address bar triggers omnibox suggestions
- [ ] `zo summarize` — summarizes the current page (output shown in omnibox suggestion or opens panel)
- [ ] `zo save` — saves page content to research notes
- [ ] `zo extract [type]` — extracts data from current page
- [ ] `zo [free-form query]` — sends query to Zo about the current page
- [ ] Omnibox suggestions are updated as user types (suggest common commands)
- [ ] When user selects a suggestion, the side panel opens with the query pre-filled (or Zo responds inline)
- [ ] `chrome.omnibox.onInputChanged` provides dynamic suggestions
- [ ] Tests: omnibox registration, suggestion generation, input handling

## Technical Notes

- `chrome.omnibox` API registered in `manifest.json`: `"omnibox": { "keyword": "zo" }`
- Background SW handles `chrome.omnibox.onInputEntered` — dispatches to Zo or opens panel
- For inline responses (simple queries), show result in `chrome.omnibox.setDefaultSuggestion`
- For complex actions, open the side panel with the query pre-filled
- The omnibox API is MV3 compatible
- Consider showing a "type `zo help` for commands" message on first interaction

## Files to Edit

- `extension/manifest.json` → add `"omnibox"` section with keyword `"zo"`
- `extension/background.js` → add `chrome.omnibox.onInputEntered`, `onInputChanged`, `onInputStarted` listeners
