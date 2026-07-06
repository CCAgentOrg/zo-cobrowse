# Shareable Co-Browse Sessions

**Phase**: P4 (Full Delegation)
**Priority**: 🟢 Nice
**Effort**: Large
**Labels**: `phase-4`, `priority-nice`

## Description

The backend relay exists but is unproven. Enable shareable co-browse sessions where multiple participants can view the same page with Zo orchestrating actions visible to all. Useful for demos, teaching, and collaborative research.

## Acceptance Criteria

- [ ] Backend WebSocket relay can handle multiple connected clients per session
- [ ] Session creation: user creates a session, gets a shareable link
- [ ] Participant join: second user joins via link, sees the same page context
- [ ] Zo actions are visible to all participants in the session
- [ ] Session host controls Zo (guest is view-only, or both can query — configurable)
- [ ] Session history is persisted for replay
- [ ] Session ends when host closes it or all participants leave
- [ ] Session link is a zo.space URL that auto-joins the extension
- [ ] Tests: WebSocket connection, multi-client message relay, session lifecycle

## Technical Notes

- Backend relay at `backend/relay.ts` — needs full implementation and testing
- Session model: Zo controls the browser; participants see Zo's actions and can optionally query
- For the join flow: session link opens a page that prompts the extension to connect
- The relay uses WebSocket for real-time communication between Zo, host, and guests
- Rate limit: ensure Zo isn't asked to execute conflicting actions from multiple participants
- Security: session tokens, host authorization, guest permissions
- Deployment: the relay should be registered with `register_user_service(mode="http", local_port=8091, public=True)`
- CORS: the extension connects from `chrome-extension://` origin, needs explicit allowlisting in the relay

## Files to Edit

- `backend/relay.ts` → full WebSocket session implementation
- `extension/background.js` → session join/leave handlers
- `extension/sidepanel.js` → session UI (invite, participants list, session status)
- `extension/sidepanel.html` → session controls
