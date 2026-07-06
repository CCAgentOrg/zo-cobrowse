# Multi-Tab Context & Cross-Tab Actions

**Phase**: P4 (Full Delegation)
**Priority**: 🟡 Medium
**Effort**: Large
**Labels**: `phase-4`, `priority-medium`

## Description

Currently Zo only sees a single tab. Parchi already supports 5 concurrent subagents across multiple tabs. Zo Co-browse needs to capture context across all open tabs and enable cross-tab actions like "compare prices on these 3 tabs."

## Acceptance Criteria

- [ ] Background SW can capture context from multiple open tabs simultaneously
- [ ] Context from all tabs is sent to Zo in a single query (structured by tab)
- [ ] Zo can open, close, and switch tabs through the extension
- [ ] "Compare this across all tabs" action sends multi-tab context to Zo
- [ ] Tab management actions: `openTab(url)`, `closeTab(tabId)`, `switchTab(tabId)`, `groupTabs(tabIds)`
- [ ] Single-query orchestration: "Research this company across all open competitor tabs"
- [ ] Tab context is displayed in a tab bar/selector within the side panel
- [ ] Tests: multi-tab context capture, cross-tab action execution, tab management

## Technical Notes

- Background SW can query all tabs via `chrome.tabs.query({})`
- Send messages to each tab to capture context, then aggregate
- For large numbers of tabs, consider limiting to the active window or a user-selectable subset
- Zo's response can specify which tab each action targets via a `tabId` field in the action schema
- Large context sizes may hit `/zo/ask` payload limits — implement smart truncation

## Files to Edit

- `extension/background.js` → multi-tab context capture, tab management actions
- `extension/content.js` → no changes (already works per-tab)
- `extension/sidepanel.js` → tab selector UI, multi-tab query dispatch
- `extension/sidepanel.html` → tab bar
- `extension/manifest.json` → `tabs` permission (already present)
