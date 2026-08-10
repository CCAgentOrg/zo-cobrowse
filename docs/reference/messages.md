# Message Types

The extension communicates across three parties — **side panel**, **background
service worker**, and **content script** — over `chrome.runtime` messaging. The
authoritative list of panel→worker message types lives in the Zod schema
[`tests/schemas/messages.ts`](https://github.com/CCAgentOrg/zo-cobrowse/blob/main/tests/schemas/messages.ts); the message-contract test asserts background.js
has a handler for **every** type in that schema.

## Panel → Background

These are the `chrome.runtime.sendMessage({ type: ... })` requests the side
panel (and options page) send:

| Type | Purpose |
|------|---------|
| `GET_PAGE_CONTEXT` | Forward to `getActiveTabContext()` — request the current tab's context at the mode's tier |
| `ASK_ZO` | Send a query to Zo with page context + current mode (`modeId`, `customModes`) |
| `TEST_CONNECTION` | Probe the Zo API + Zo.space endpoint |
| `GET_CONFIG` | Return sanitized config (token presence, URL, model) |
| `LIST_MODELS` | List available models |
| `LIST_PERSONAS` | List configured personas |
| `EXECUTE_ACTIONS` | Run a batch of actions on the active tab |
| `NAVIGATE` | Navigate a tab to a URL |
| `GENERATE_MODE` | Ask Zo to design a custom mode (`✦` generator) |
| `SAVE_PAGE` | Save the current page to the Zo workspace as Markdown |
| `RUN_SKILL` | Run a Zo skill on the current page |
| `CREATE_AUTOMATION` | Create a scheduled Zo automation (`!auto`) |
| `LIST_AUTOMATIONS` | List scheduled automations (`!autos`) |
| `DUCKDB_QUERY` | Run a natural-language DuckDB query (`!query` / `!data`) |
| `NEW_CONVERSATION` | Reset `zoConversationId` to `null` |
| `RECREATE_CONTEXT_MENUS` | Rebuild right-click context menus |

## Background → Content

| Type | Direction | Purpose |
|------|-----------|---------|
| `CAPTURE_CONTEXT` | BG → Content | Get a page DOM snapshot (`captureContext()`) |
| `EXECUTE_ACTION` | BG → Content | Run a single (or batch of) browser action(s) in the DOM |

## Background → Panel (streaming)

Streaming responses flow back over a long-lived `chrome.runtime.Port`
(`streamPort`) rather than one-shot messages:

| Type | Purpose |
|------|---------|
| `STREAM_CHUNK` | Incremental text/reasoning delta (echoes `sessionId`) |
| `STREAM_DONE` | Final payload — canonical `responseText` + `reasoning` + executed actions |
| `STREAM_RECONNECT` | Emitted before a retry of a transient error |
| `STREAM_ERROR` | A permanent, non-retriable error |
| `STREAM_DIAGNOSTIC` | SSE shape-discovery record (`streamShape`) |

Every `STREAM_*` message echoes the query's `sessionId` so the panel only
applies messages that belong to the current query (see
[Streaming](../concepts/streaming)).

## Content Script setup

The content script is declared in `manifest.json` (all URLs, `run_at:
document_idle`, `all_frames: false`). Because injection happens at
`document_idle`, on freshly opened tabs the content script may not be loaded
yet when the side panel first queries — the extension falls back to
`chrome.scripting.executeScript` for both `CAPTURE_CONTEXT` and
`EXECUTE_ACTION`, so the user experience is seamless.

## Contract guarantee

Two contract tests guard these boundaries:

- `tests/message-contract.test.ts` asserts background.js has a `case` for
  **every** message type in the schema **and** that the schema isn't missing a
  handler background.js already implements.

**Add a new message type → add it to `tests/schemas/messages.ts`, or the
message-contract test fails.**
