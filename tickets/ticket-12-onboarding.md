# Onboarding Flow

**Phase**: P5 (Platform & Distribution)
**Priority**: 🟡 Medium
**Effort**: Medium
**Labels**: `phase-5`, `priority-medium`

## Description

New users who install the extension currently see a blank side panel with no guidance. There's no first-run experience — no wizard, no sample queries, no connection test flow. This creates a high abandonment rate for users who haven't set up a Zo account yet.

## Acceptance Criteria

- [ ] First install shows a welcome/onboarding screen in the side panel, not the empty chat
- [ ] Step 1: "Connect your Zo" — explains what Zo is and shows a button to open settings
- [ ] Step 2: "Enter your access token" — links to Zo Settings > Advanced with instructions
- [ ] Step 3: "Test connection" — auto-runs the connection test, shows success/failure
- [ ] Step 4: "Try it" — shows 3 sample queries the user can click to test
- [ ] After onboarding completes, user sees the normal chat view
- [ ] Onboarding state persists — if user closes panel mid-onboarding, they resume where they left off
- [ ] Return users with valid config skip onboarding and go straight to chat
- [ ] Options page has a "Reset onboarding" button
- [ ] Tests: onboarding state machine, step progression, completion detection

## Technical Notes

- Onboarding state stored in `chrome.storage.sync` under `cobrowse_onboarding_done` and `cobrowse_onboarding_step`
- Onboarding overlay renders inside `#chat-view`, hiding messages until complete
- Connection test calls `TEST_CONNECTION` — same endpoint used in options
- Sample queries: "Summarize this page", "Extract all links", "What form fields are on this page?"
- Consider adding a "What is Zo?" info card with links to zo.computer

## Files to Edit

- `extension/sidepanel.html` → onboarding container (could be overlay)
- `extension/sidepanel.js` → onboarding state machine, step rendering, progress save
- `extension/styles.css` → onboarding styles
- `extension/options.html` → reset onboarding button
