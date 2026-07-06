# Run Skills from Side Panel

**Phase**: P3 (Zoverignty — Browser as Zo Terminal)
**Priority**: 🔴 High
**Effort**: Small
**Labels**: `phase-3`, `priority-high`

## Description

Zo has 89+ installed skills (video pipelines, research, data analysis, etc.) but they're inaccessible from the browser. The side panel should let the user browse, search, and run any Zo skill with the current page context as input.

## Acceptance Criteria

- [ ] Side panel has a "Skills" tab/section listing installed skills
- [ ] Skills can be searched/filtered by name
- [ ] User can run a skill with current page context as source material
- [ ] Running a skill sends a command to Zo via `/zo/ask` to execute the skill (e.g., "Run skill `cc-awareness-video` on this page")
- [ ] Skill execution status is displayed in the panel (started, running, completed, failed)
- [ ] Results/status are displayed inline in the conversation
- [ ] Frequently used skills can be favorited/pinned to the panel
- [ ] Tests: verify skill listing, search, run dispatch, status display

## Technical Notes

- Zo doesn't expose a "list skills" API endpoint directly — the skill runner works by prompting Zo to execute the skill via its toolchain
- Prompt strategy: "Run the skill `<skill-name>` using the content from this page: [page context]"
- The skills list could be hardcoded in a config or fetched by asking Zo "list your available skills"
- Consider caching the skills list locally in `chrome.storage.local`

## Files to Edit

- `extension/sidepanel.html` → add skills tab/section
- `extension/sidepanel.js` → skill listing, search, run dispatch
- `extension/styles.css` → skills UI styles
- `extension/background.js` → skill run message handler (minimal — most logic in prompt)
