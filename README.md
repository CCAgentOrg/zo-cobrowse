# Zo Co-browse

[![CI](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml/badge.svg)](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml)


> ***Browser extension + Zo backend — AI that sees your page, understands context, and acts through your browser.***

A co-browsing extension that connects your browser to your [Zo Computer](https://zocomputer.com) as the AI backend. Zo sees your page DOM, uses its full toolchain (DuckDB, files, web search, integrations), and returns structured browser actions — click, fill, navigate, extract.

## Architecture

```
Browser Tab ──→ Content Script ──→ Side Panel ──→ Background SW
     ↑                                                              |
     |                     ┌──────────────────────────────┐        |
     └── Actions ──────────┤  Backend Service (optional)  │        |
                           │  WebSocket relay / MCP       │        |
                           └──────┬───────────────────────┘        |
                                  ↓                                ↓
                          ┌────────────────┐           ┌──────────────────┐
                          │ Zo.space API   │           │ Zo /zo/ask API   │
                          │ (data queries) │           │ (AI + tools)     │
                          └────────────────┘           └──────────────────┘
```

**Two channels:**

| Channel | Endpoint | What it does |
|---------|----------|-------------|
| **AI Brain** | `POST /zo/ask` | Page context + user query → Zo reasons, uses all tools, returns structured browser actions |
| **Data/MCP** | `zo.space/api/cobrowse/*` + WebSocket service | Quick data lookups (DuckDB), session relay, Zo.space integration |

## Extension Setup

1. **Open Chrome** → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select `extension/` directory
4. Pin the extension icon in the toolbar

### Configure it

1. **Right-click the icon → Options** (or right-click in the side panel → "Options")
2. Enter your **Zo Access Token**:
   - Go to your [Zo Settings → Advanced](https://cashlessconsumer.zo.computer/?t=settings&s=advanced)
   - Create an **Access Token**
   - Paste it into the extension settings
3. Click **Test Connection** — you should see a success message

### Use it

1. Navigate to any page
2. Click the extension icon → opens side panel
3. The panel shows the current page context
4. Type a question or command, e.g.:
   - *"Summarize this article in 3 bullet points"*
   - *"Find the submit button and fill this form with dummy data"*
   - *"Extract all table data from this page"*
   - *"Scroll down and click 'Load More'"*
5. Zo responds with text + executes browser actions

## Backend Service

The optional WebSocket relay enables **multi-participant co-browsing** and real-time Zo.space data access.

### Deploy the relay

```bash
cd backend
bun install
bun run relay.ts
```

Register as a user service:

```
bun run relay.ts --port 8091
```

Then register with Zo:
- `register_user_service` with `mode="http"`, `local_port=8091`

### Zo.space API Routes

| Route | Purpose | Auth |
|-------|---------|------|
| `POST /api/cobrowse/query` | DuckDB read queries | Bearer token (optional) |

### Environment Variables

Set in [Settings → Advanced](https://cashlessconsumer.zo.computer/?t=settings&s=advanced):

| Secret | Used By | Purpose |
|--------|---------|---------|
| `CO_BROWSE_SECRET` | Zo.space API | Authenticate extension → Zo.space queries |

## Files

```
extension/
├── manifest.json        # Chrome MV3 manifest
├── background.js        # Service worker — Zo API comms, action routing
├── content.js           # DOM capture + browser action executor
├── sidepanel.html       # Chat interface HTML
├── sidepanel.js         # Chat interface logic
├── options.html         # Settings page HTML
├── options.js           # Settings page logic
├── styles.css           # Dark-theme shared styles
└── icons/               # Extension icons

backend/
├── relay.ts             # WebSocket relay + Zo.space bridge
└── README.md            # Backend deployment guide

README.md                # This file
```

## Development

Extension files live under `extension/`. After editing, reload the extension from `chrome://extensions/reload` (or use the chrome://extensions page).

To test backend: `bun run backend/relay.ts` and verify with `curl`.

## Why This Pattern

Parchi, BrowserOS, Dia, Comet — all these products share the same fundamental insight: **AI is most powerful when it lives inside the browser context**. The difference here is:

- **Your Zo is the AI backend** — all your existing toolchain (DuckDB datasets, skills, automations, files) is available to the co-browsing agent
- **Open, not walled** — the extension talks to APIs you control. No third-party cloud lock-in
- **Extensible** — add new capabilities by writing Zo skills and Zo.space routes

## License

MIT — built for Cashless Consumer by Zo Computer.
