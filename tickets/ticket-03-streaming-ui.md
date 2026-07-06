# Streaming Action Timeline

**Phase**: P2 (Everywhere, Layered)
**Priority**: 🟡 Medium
**Effort**: Medium
**Labels**: `phase-2`, `priority-medium`

## Description

The side panel currently shows Zo's full response text (which the model formats as markdown with JSON-encoded actions). There's no visual distinction between Zo's reasoning and the actions being taken — no real-time tool execution timeline like Parchi has. This makes it hard to follow what Zo is doing.

## Acceptance Criteria

- [ ] Zo's response is split into two visual sections: a "Reasoning" area (collapsible, shows thinking) and a separate "Actions" area
- [ ] Each action is displayed as a small card/timeline entry with icon, type label, and status (pending → running → done/error)
- [ ] Actions animate through a visual timeline as they execute (click → fill → scroll → done)
- [ ] Failed actions are highlighted in red with the error message
- [ ] The actions bar animates away once all actions complete
- [ ] Action execution progress is shown (e.g., "3/5 actions completed")
- [ ] Tests: verify action card rendering, status transitions, error states

## Technical Notes

- Side panel already has `pendingActions` state and `actionsBar` DOM element — extend this
- Add a new `#action-timeline` container inside `#actions-bar`
- Each action card: action.type icons (click → 👆, fill → ✏️, scroll → 📜, navigate → 🔗, extract → 📋, wait → ⏳, done → ✅)
- Use CSS transitions for status changes (pending → running → done/error)
- The streaming piece (token-by-token display of Zo's reasoning) depends on `/zo/ask` SSE streaming support — this ticket can ship the non-streaming timeline first
- The `executeActions()` function in `extension/background.js` already returns individual results — pipe them back to the panel incrementally

## Files to Edit

- `extension/sidepanel.js` → action timeline rendering, status updates
- `extension/styles.css` → action card styles, timeline visual
- `extension/background.js` → optionally pipe action results back to panel in real-time
