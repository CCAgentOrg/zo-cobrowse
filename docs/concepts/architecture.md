# Architecture

Zo Co-browse is a Chrome **Manifest V3** extension with an optional WebSocket
backend. It has three browser entry points — the background service worker, the
content script, and the side panel — plus a pure-logic library layer.

## The big picture

```
Browser Tab ──→ Content Script ──→ Side Panel ──→ Background SW
     ↑                                                    |
     │              ┌────────────────────────────┐        |
     └── Actions ───┤  WebSocket Relay (optional)│        |
                    └──────┬─────────────────────┘        |
                           ↓                              ↓
                   ┌──────────────┐            ┌──────────────────┐
                   │ Zo.space API │            │ Zo /zo/ask API   │
                   │ (data)       │            │ (AI + tools)     │
                   └──────────────┘            └──────────────────┘
```

## Components

### Background service worker — `extension/background.js`

The hub of the extension. Key responsibilities:

- **All Zo API communication** — `askZoStream()` (primary streaming path),
  `askZo()` (non-streaming fallback), `testConnection()`, `generateMode()`.
- **Message routing** — every message from the side panel and content script
  goes through the worker's `onMessage` handler.
- **Config persistence** — loads/watches config from Chrome storage.
- **Conversation threading** — tracks `zoConversationId` and sends it as
  `conversation_id` on every `/zo/ask` call.
- **Page context capture** — `getActiveTabContext(tabId, tier, modeId)`, the
  CDP eval fast-path (via the `debugger` permission) that reads the page DOM.
  Capture is **tier-gated**: 0=URL only, 1=+text, 2=+clickable+forms with
  selectors, 3=+screenshot.
- **Action execution** — `executeActions()` turns Zo's `{actions:[...]}` into
  browser actions.
- **Prompt assembly** — `buildPrompt(mode, pageContext, userQuery)`, the single
  shared prompt builder.

Top-level helpers: `safePost()` (no-ops on dead ports), `isRetriableStreamError()`.

### Content script — `extension/content.js`

Injected into every page (`<all_urls>`, `run_at: document_idle`). Two jobs:

- **`captureContext()`** — extracts URL/title/visibleText/formFields/clickable
  elements with generated CSS selectors.
- **`executeDomAction()`** — runs a single browser action in the DOM:
  click, fill, extract, scroll, wait, navigate, done.

It communicates with the worker via `chrome.runtime.onMessage`
(`CAPTURE_CONTEXT`, `EXECUTE_ACTION`).

### Side panel — `extension/sidepanel.js`

The chat UI (~100 KB, the largest file). Manages conversation history (in
`chrome.storage.local`, key `zo_cobrowse_history`, max 50 messages), the
streaming path (`streamPort` / `handleStreamMessage`, guarded by a per-query
`streamSession.sessionId`), mode lifecycle, and the auto-execution of pending
actions Zo returns.

### Pure logic library — `extension/lib/`

ES modules with **no `chrome.*` or DOM dependencies**, so they import directly
into tests:

| Module | Purpose |
|--------|---------|
| `modes.js` | `BUILTIN_MODES`, `resolveMode`, `presetToMode`, `normalizeActions`, `ACTION_SCHEMA_COMPACT` |
| `bang-commands.js` | `parseBangCommand()` — `!` command parser |
| `intent.js` | `detectIntent()`, `shouldDowngradeToJsonDisabled()` — action-vs-read classification |
| `config.js` | The `DEFAULTS` config object + storage helpers |

### Options page — `extension/options.html` + `.js`

Settings UI. Saves token, API URL, model, and Zo.space endpoint to
`chrome.storage.sync`. Test-connection flow + "Reset to defaults".

### Backend relay — `backend/relay.ts`

Optional HTTP + WebSocket service for multi-participant sessions. Not required
for single-user co-browsing. See [Backend Relay](../backend).

## Two channels

| Channel | Endpoint | What it does |
|---------|----------|-------------|
| **AI Brain** | `POST /zo/ask` | Page context + query → Zo reasons with all its tools → returns structured actions |
| **Data/MCP** | `zo.space/api/cobrowse/*` | DuckDB queries, web research, Zo.space data |

## Message flow

```
Side Panel ──sendMessage──> Background SW ──fetch──> Zo /zo/ask API
Background SW ──tabs.sendMessage──> Content Script ──> DOM actions
Background SW ──scripting.executeScript──> (fallback if content script not loaded)
```

For the full list of message types, see [Message Types](../reference/messages).

## Permissions

From `manifest.json`:

- `debugger` — required for the CDP eval fast-path in `getActiveTabContext()`.
  Chrome shows a standard "is being debugged" banner while it runs.
- `contextMenus`, `sidePanel`, `storage`, `activeTab`, `tabs`, `scripting`, `tts`
- `host_permissions`: `https://api.zo.computer/*`, `https://*.zo.space/*`,
  `https://*.zocomputer.io/*`, `http://*/*`, `https://*/*`

::: tip
The `<all_urls>` host permissions are what allow `scripting.executeScript` to
work on arbitrary pages. If the manifest lacks them, context capture fails
silently.
:::
