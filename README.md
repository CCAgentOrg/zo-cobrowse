# Zo Co-browse

[![CI](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml/badge.svg)](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml)
[![Docs](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/docs.yml/badge.svg)](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/docs.yml)

> ***Browser extension + Zo backend — AI that sees your page, understands context, and acts through your browser.***

A co-browsing extension that connects your browser to [Zo Computer](https://zocomputer.com) as the AI backend. Zo sees your page DOM, uses its full toolchain (DuckDB, files, web search, integrations), and returns structured browser actions.

📖 **Full documentation: [https://ccagentorg.github.io/zo-cobrowse/](https://ccagentorg.github.io/zo-cobrowse/)**

## Architecture

```
Browser Tab ──→ Content Script ──→ Side Panel ──→ Background SW
     ↑                                                    |
     │              ┌────────────────────────────┐        |
     └── Actions ───┤  WebSocket Relay (optional)│        │
                    └──────┬─────────────────────┘        │
                           ↓                              ↓
                   ┌──────────────┐            ┌──────────────────┐
                   │ Zo.space API │            │ Zo /zo/ask API   │
                   │ (data)       │            │ (AI + tools)     │
                   └──────────────┘            └──────────────────┘
```

### Two channels

| Channel | Endpoint | What it does |
|---------|----------|-------------|
| **AI Brain** | `POST /zo/ask` | Page context + query → Zo reasons with all tools → returns structured actions |
| **Data/MCP** | `zo.space/api/cobrowse/*` | DuckDB queries, web research, Zo.space data |

### Conversation threading

The extension tracks `conversation_id` returned by `/zo/ask` and sends it on every subsequent call — so Zo sees your full chat history. A **New Chat** button resets the thread on Zo and clears stored history.

## Extension Setup

1. **Open Chrome** → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select `extension/` directory
4. Pin the extension icon

### Configure

1. **Right-click icon → Options** (or right-click in side panel → "Options")
2. Enter your **Zo Access Token**:
   - Go to [Zo Settings → Advanced](https://cashlessconsumer.zo.computer/?t=settings&s=advanced)
   - Create an **Access Token**, paste into extension settings
3. Click **Test Connection**

### Use

1. Navigate to any page → click the extension icon → side panel opens
2. Panel shows current page context. Type a command:
   - *"Summarize this article in 3 bullet points"*
   - *"Find the submit button and fill this form with dummy data"*
   - *"Extract all table data from this page"*
   - *"Scroll down and click 'Load More'"*
3. Zo's response appears in-conversation; browser actions run automatically

## Backend

Optional WebSocket relay for multi-participant co-browsing.

```bash
cd backend && bun run relay.ts
```

Register as a user service: `mode="http"`, port `3101`.

### Zo.space API

| Route | Purpose |
|-------|---------|
| `POST /api/cobrowse/query` | DuckDB read queries |

### Secrets

The extension authenticates to Zo.space with your **Zo Access Token** (Bearer), set in [Settings → Advanced](https://cashlessconsumer.zo.computer/?t=settings&s=advanced).

## Project Structure

```
extension/
├── manifest.json          # Chrome MV3 manifest (sidePanel, scripting, tabs)
├── background.js          # Service worker — Zo API, message routing, config
├── content.js             # DOM capture + browser action executor (content script)
├── sidepanel.html         # Chat interface
├── sidepanel.js           # Chat logic — history, auto-execution, new-chat
├── options.html           # Settings page
├── options.js             # Settings logic — token entry, connection test
├── styles.css             # Zo-native shared styles
├── lib/                   # Pure ES modules (no chrome.* deps, unit-tested)
└── icons/                 # Extension icons (16/48/128)

backend/
├── relay.ts               # WebSocket relay + Zo.space bridge
└── README.md              # Backend deployment guide

tests/
├── schemas/                # Zod contract schemas (single source of truth for shapes)
│   ├── manifest.ts
│   ├── actions.ts
│   ├── messages.ts
│   ├── config.ts
│   ├── bang-commands.ts
│   └── modes.ts
├── manifest.test.ts        # Manifest validation against schema
├── message-contract.test.ts# Message contract completeness
├── html.test.ts            # UI element presence
├── background.test.ts      # Config, messaging, omnibox, generate
├── content.test.ts         # Context capture, actions
├── sidepanel.test.ts       # History, init, new-chat, presets, onboarding
├── options.test.ts         # Settings form
├── bang-commands.test.ts   # Bang (!) command parser
└── relay.test.ts           # WebSocket endpoints

lib/                        # Pure ES modules (no chrome.* deps, testable directly)
└── bang-commands.js        # Bang command parser — the reference pattern

README.md                   # This file
AGENTS.md                   # Project routing for AI agents
```

## Development

Reload from `chrome://extensions` after edits. Verify before every commit:

```bash
bun install        # once — installs zod + bun-types
bun run setup-hooks # once — installs the pre-commit verification gate
bun run verify     # tests + release checks + transpile check (also runs pre-commit)
bun test           # 494 tests across 23 test files + 6 schema files
bun test:watch     # Watch mode
```

## Why This Pattern

Parchi, Browser OS, Dia, Comet — all share the insight: **AI is most powerful inside the browser context**. The difference:

- **Your Zo is the backend** — all your datasets, skills, automations are available
- **Open, not walled** — talks to APIs you control, no third-party lock-in
- **Extensible** — add capabilities by writing Zo skills and zo.space routes

**License:** MIT
