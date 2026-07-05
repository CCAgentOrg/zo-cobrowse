# Zo Co-browse — Architecture Notes

## Two-Channel Architecture

The extension communicates with Zo via two parallel channels:

### Channel 1: `/zo/ask` (AI Brain)
- **Purpose**: Page context + user query → Zo reasons → structured actions back
- **Auth**: Bearer token (Access Token from Zo Settings → Advanced → Access Tokens)
- **Endpoint**: `https://api.zo.computer/zo/ask`
- **Payload**: Page context (URL, title, visible text) + user query
- **Response**: JSON with `reasoning` + `actions` array
- **Model**: Default `byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc`

### Channel 2: Zo.space APIs (Data Channel)
- **Purpose**: DuckDB queries, web research, dataset lookups
- **Auth**: Bearer token (`CO_BROWSE_SECRET` in Settings → Advanced → Secrets)
- **Endpoints**: `https://cashlessconsumer.zo.space/api/cobrowse/query`, `/research`
- **Usage**: Fast structured data access without full AI inference

## Extension Components

| Component | Role |
|-----------|------|
| `background.js` | Service worker — API calls, config, message routing |
| `content.js` | Injected in pages — captures DOM context, executes actions |
| `sidepanel.html` | Chat interface — shows conversation, current page, quick actions |
| `options.html` | Settings page — API URL, token, model, connection test |
| `styles.css` | Dark theme, shared across sidepanel + options |

## Action Types (Zo → Extension)
- `navigate` — Navigate to URL
- `click` — Click element by CSS selector
- `fill` — Fill form field
- `extract` — Extract text/attribute from element
- `scroll` — Scroll up/down
- `wait` — Wait milliseconds
- `done` — Final response to show user

## Future Work
- WebSocket relay for real-time co-browsing (extension + relay.ts service)
- Multiple participant sessions (collaborative browsing)
- Session replay / recording
- Integration with Zo MCP for tool access
