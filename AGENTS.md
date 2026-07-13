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

[![CI](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml/badge.svg)](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml)

**126 tests across 12 files. 126 passing (no failures). Adding a feature means adding/updating the corresponding test file under `tests/`.

## Ticket completion

| Ticket | Status | Key files |
|--------|--------|-----------|
| #01 Screenshot & Vision | ✅ Done | background.js (captureVisibleTab, JPEG+quality), options.js (screenshot toggle) |
| #02 Right-Click Context Menu | ✅ Done | background.js, manifest.json (contextMenus) |
| #03 Streaming Action Timeline | ✅ Done | sidepanel.js (actionTimeline + reconnection banner), sidepanel.html (timeline UI) |
| #04 Run Skills from Panel | ✅ Done | sidepanel.js (skill subprompt), background.js (prompt construction) |
| #05 NL → DuckDB Queries | ✅ Done | sidepanel.js (query subprompt), tests/ |
| #06 Keyboard Shortcuts | ✅ Done | manifest.json (commands), background.js (onCommand) |
| #07 Quick Command Templates | ✅ Done | sidepanel.html (presets UI), sidepanel.js (preset execution) |
| #08 Create Automations | ✅ Done | background.js (GENERATE_AUTOMATION handler), bang-commands.js (!auto) |
| #09 Save Page to Workspace | ✅ Done | background.js (SAVE_PAGE handler), sidepanel.js (!save) |
| #10 Multi-Tab Context | ⏳ Backlog | content.js (tab state) |
| #11 Web Store Listing | ⏳ Final step | Store assets, screenshots, description |
| #12 Onboarding Flow | ✅ Done | sidepanel.html (onboarding overlay), sidepanel.js (state machine) |
| #13 Omnibox Commands | ✅ Done | manifest.json (omnibox), background.js (onInputChanged/onInputEntered) |
| #14 Page Monitoring | ⏳ Backlog | ticket-14-page-monitoring.md — not implemented |
| #15 Shared Sessions | 🟡 Scratch | backend/relay.ts (WebSocket backend exists), extension integration not done |

### 🟢 Tier 1 — Unique Zo Moat (build first)

| # | Gap | Zo Affinity | Priority | Key files |
|---|-----|-------------|----------|-----------|
| #16 | **Scheduled AI Commands** | 10/10 | **P0** | Zo automations (48 exist) + panel UI to create/manage. Only ZoCoBrowse can do this at depth. See `brainstorming/ZO_AFFINITY_RANKING.md` |
| #17 | **Web Monitoring & Page Change Detection** | 10/10 | **P0** | Zo automations as backend + DuckDB change history + workspace archival. Competitors monitor pages; Zo triggers skills on change. See `brainstorming/ZO_AFFINITY_RANKING.md` |
| #18 | **Shared Sessions (multi-participant)** | 9/10 | **P1** | `backend/relay.ts` exists. Multi-user co-browsing over WebSocket is ZoCoBrowse's unique architectural moat. No competitor has this. |
| #19 | **Multi-Model Selection UI** | 9/10 | **P1** | Zo BYOK supports any provider. A model picker in the panel unlocks Zo's full flexibility from the browser. |
| #20 | **Tab Compare / Side-by-Side** | 8/10 | **P1** | Multi-tab context → Zo cross-references with DuckDB datasets, runs skills on merged context. HARPA compares URLs; Zo cross-references intelligently. |

### 🟡 Tier 2 — Strong Zo Leverage (next)

| # | Gap | Zo Affinity | Priority | Key files |
|---|-----|-------------|----------|-----------|
| #21 | **Page Context Export (PDF/MD)** | 7/10 | **P2** | Zo has `book-typesetting` skill (pandoc+Eisvogel) and Hugo pipeline. Export → Zo formats and publishes. |
| #01 | **Screenshot & Vision Capture** | 7/10 | **P2** | ✅ Done (captureVisibleTab + JPEG). Zo can analyze with vision, save to workspace. |
| #14 | **Page Monitoring (basic)** | 6/10 | **P2** | Periodic re-capture with Zo drives automations. Pair with #17 for full power. |
| #02 | **Right-click Context Menu** | 6/10 | **P2** | ✅ Done. "Research/Summarize/Explain with Zo". Menu items can trigger specific skills. |

### 🔴 Tier 3 — Parity Catch-up (later)

| # | Gap | Zo Affinity | Priority | Key files |
|---|-----|-------------|----------|-----------|
| — | **Image/file upload to panel** | 5/10 | **P3** | Upload → Zo reads & runs skills. Mostly UX work. |
| — | **Action Templates Library** | 4/10 | **P3** | Pre-built prompts. Could generate from 89 Zo skills. HARPA has 100+ templates. |
| #23 | **Workflow Recording** | 4/10 | **P3** | Record/replay clicks. Competitors win here. Future: save workflows as Zo skills. |
| — | **Streaming Responses** | 3/10 | ✅ Done | Pure UX. Done per #03. |
| — | **Download files** | 3/10 | **P3** | Generic browser feature. |
| — | **Risk confirmation dialogs** | 2/10 | **P3** | Browser UX. Every extension has it. |
| #10 | **Site-Level Permission Controls** | 2/10 | **P3** | Chrome config UI. Zero differentiation. |
| — | **Console & Network Logs** | 2/10 | **P3** | Devtools integration. Low ROI vs Tier 1. |
| #11 | **Web Store Listing** | 1/10 | **P4** | Distribution, not a feature. Must-do to ship. |

Full analysis: `brainstorming/ZO_AFFINITY_RANKING.md`

## Verification layer (Zod schemas) — read before adding features

Contracts are defined as **Zod schemas** in `tests/schemas/` and used by the tests as the single source of truth. Prefer schema validation over scattered `.toContain()` string checks.

| Schema file | Validates | Used by |
|-------------|-----------|---------|
| `tests/schemas/manifest.ts` | full `manifest.json` (MV3 shape, commands, omnibox, icons, permissions) | `tests/manifest.test.ts` |
| `tests/schemas/actions.ts` | the Zo action protocol (`navigate`/`click`/`fill`/`extract`/`scroll`/`wait`/`done`) | `tests/message-contract.test.ts` |
| `tests/schemas/messages.ts` | every message type passed sidepanel ↔ background ↔ content | `tests/message-contract.test.ts` |
| `tests/schemas/config.ts` | the `DEFAULTS` config object | (config tests) |
| `tests/schemas/bang-commands.ts` | `parseBangCommand()` output (discriminated union on `kind`) | `tests/bang-commands.test.ts` |

**Two contract tests guard the boundaries:**
- `tests/message-contract.test.ts` — asserts background.js has a `case` for **every** message type in the schema, AND that the schema isn't missing any handler background.js already implements. Add a new message type → add it to the schema or this test fails.

**Pattern for pure logic:** extract into `extension/lib/<name>.js` as an ES module (no `chrome.*`/DOM deps), import it from the consuming extension script (which must be loaded as `type="module"` in its HTML), and unit-test it by importing directly + validating output against its Zod schema. See `extension/lib/bang-commands.js` ↔ `tests/bang-commands.test.ts` as the reference.

When you add a feature: extend the relevant schema first, then write the code + a test that validates the code's output against the schema. This catches structural regressions that `.toContain()` misses.

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
