# Create Automations from Page

**Phase**: P3 (Zoverignty — Browser as Zo Terminal)
**Priority**: 🔴 High
**Effort**: Small
**Labels**: `phase-3`, `priority-high`

## Description

Zo's unique capability is creating persistent automations. The extension should let users create scheduled agents from the browser: "Watch this page for changes", "Send me a daily summary of this page", "Email me when this price changes". No competitor can do this.

## Acceptance Criteria

- [ ] Right-click or panel command: "Create automation from this page"
- [ ] User selects trigger type: time-based (daily, weekly), change-detection (page content changes)
- [ ] User specifies action: summarize, extract specific data, alert on change
- [ ] Automation is created in Zo via prompt to `/zo/ask` (Zo creates an agent/automation)
- [ ] Confirmation with automation details displayed in panel
- [ ] List of created automations shown in panel (from memory or Zo query)
- [ ] Automations can be paused/disabled from the panel
- [ ] Tests: verify automation creation flow

## Technical Notes

- Zo can create automations through its toolchain — the prompt asks Zo to "create a scheduled agent that checks this page daily and emails me a summary"
- For page monitoring: Zo would need to periodically fetch the page URL through its browser tools
- The panel should show automation status using Zo memory or an API call to list automations
- Automation triggers are managed server-side (Zo), not in the extension

## Files to Edit

- `extension/sidepanel.js` → automation creation UI, status panel
- `extension/sidepanel.html` → automation section
- `extension/background.js` → automation message handler
