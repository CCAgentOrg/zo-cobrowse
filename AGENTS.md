# Zo Co-browse — AGENTS.md

Compact project index for agents working on this codebase.

## Overview

Chrome MV3 extension + optional WebSocket backend that connects the browser to [Zo Computer](https://zocomputer.com) as the AI co-browsing backend. Zo sees the page DOM, uses its full toolchain (DuckDB, skills, web search, files, integrations), and returns browser actions (click, fill, navigate, extract, scroll).

## To understand quickly

- **`extension/background.js`** — entry point for the service worker. All Zo API communication, message routing, config persistence, conversation_id tracking. Key functions: `getActiveTabContext()`, `askZo()`, `executeActions()`, `testConnection()`.
- **`extension/content.js`** — injected into web pages. `captureContext()` extracts URL/title/visibleText/formFields/clickable elements. `executeAction()` runs click/fill/extract/scroll/wait in the DOM. Communicates via `chrome.runtime.onMessage` (`CAPTURE_CONTEXT`, `EXECUTE_ACTION`).
- **`extension/sidepanel.js`** — chat UI. Manages conversation history (stored in `chrome.storage.local`, key `zo_cobrowse_history`, max 50 messages). Sends `ASK_ZO`, `GET_PAGE_CONTEXT`, `NEW_CONVERSATION`, `EXECUTE_ACTIONS` to background. Auto-runs pending actions returned by Zo. "New Chat" button (`#new-chat-btn`) sends `NEW_CONVERSATION` + clears stored history + re-fetches page context.
- **`extension/options.html`/`.js`** — settings UI. Saves token, API URL, model, Zo.space endpoint to `chrome.storage.sync`. Test connection flow.
- **`backend/relay.ts`** — optional HTTP+WebSocket service for multi-participant sessions. Not required for single-user co-browsing.

## Key patterns

- **Two-channel approach**: `/zo/ask` for AI inference + action generation; Zo.space API routes for quick data queries (DuckDB, research).
- **Conversation threading**: background.js stores `zoConversationId`, sends it as `conversation_id` to every `/zo/ask` call. Zo respects this for thread continuity.
- **Graceful fallback**: content script (`chrome.tabs.sendMessage`) tried first for context/actions; falls back to `chrome.scripting.executeScript` if content script not loaded.
- **No output_format in API calls**: Zo didn't support `array` type in the `output_format` schema. Instead, the prompt asks for JSON and the code parses it from the text response.

## Permissions

From `manifest.json`:
- `sidePanel`, `storage`, `activeTab`, `tabs`, `scripting`
- `host_permissions`: `https://api.zo.computer/*`, `https://*.zo.space/*`, `http://*/*`, `https://*/*`

## Tests

```bash
bun test
```

39 tests across 7 files. Adding a feature means adding/updating the corresponding test file under `tests/`.

## When to use this

- User wants "co-browsing", "browser AI", "extension that controls the page"
- User mentions Parchi, Browser OS, Dia, Comet as references
- User wants Zo to see what they're browsing and act through the browser
- User reports extension bugs (context capture failures, 422 errors, JSON parse errors)

## Files to edit

| Task | File |
|------|------|
| Change prompt/action schema | `extension/background.js` → `askZo()` |
| Add new action type | `extension/content.js` + `extension/background.js` → `executeDomAction()` |
| Fix context capture | `extension/background.js` → `getActiveTabContext()` |
| Change conversation display | `extension/sidepanel.js` → `addMessage()`, `sendQuery()` |
| Add settings field | `extension/options.html` + `extension/options.js` |
| Update manifest | `extension/manifest.json` |
| Add/modify test | `tests/*.test.ts` |
| Modify backend relay | `backend/relay.ts` |
