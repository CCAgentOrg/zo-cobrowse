# Page Monitoring & Change Detection

**Phase**: P4 (Full Delegation)
**Priority**: 🟢 Nice
**Effort**: Medium
**Labels**: `phase-4`, `priority-nice`

## Description

Zo should be able to watch a page for changes and alert the user or take action. This turns the extension into a persistent monitoring tool — track price drops, policy changes, job postings, or any dynamic content.

## Acceptance Criteria

- [ ] User can right-click → "Watch this page for changes" to create a monitor
- [ ] User specifies check frequency (hourly, daily, weekly)
- [ ] User specifies what to watch: entire page, specific element (CSS selector), or specific text pattern
- [ ] User specifies action on change: notify (Telegram/email), save snapshot, or alert in panel
- [ ] Zo periodically fetches the page (via its browser tools) and compares content
- [ ] Change is detected using content diffing (text hash comparison or structural diff)
- [ ] User is notified when a change is detected (via configured channel)
- [ ] List of active monitors is shown in the side panel
- [ ] Monitors can be paused, resumed, or deleted from the panel
- [ ] Tests: monitor creation, change detection, notification dispatch

## Technical Notes

- Page monitoring is driven by Zo's scheduled agent system — this feature creates agents that periodically fetch and compare page content
- The extension stores monitor configurations locally (URL, selector, frequency, action)
- When triggered, the agent reports results back via the user's configured channel
- Content comparison can use simple text hash or more sophisticated diff algorithms
- Consider rate limiting: don't check a page more than once per 15 minutes

## Files to Edit

- `extension/sidepanel.js` → monitor list UI, creation dialog, status indicators
- `extension/sidepanel.html` → monitoring section in panel
- `extension/background.js` → monitor creation handler (prompts Zo to create agent)
