# Zo Co-browse Extension — Agent Notes

## State machine

- `conversation` array in sidepanel.js — local chat history, persisted to `chrome.storage.local` under key `cobrowse_convos`
- `zoConversationId` in background.js — tracks Zo's conversation thread across the session
- `config` (background.js) — loaded from `chrome.storage.sync`, watched for changes
- `pendingActions` (sidepanel.js) — actions queued for auto-execution after Zo responds

## Message flow

Side Panel → `chrome.runtime.sendMessage` → Background SW → `fetch` to Zo API

Background SW → `chrome.tabs.sendMessage` → Content Script → DOM actions
Background SW → `chrome.scripting.executeScript` → (fallback if content script not loaded)

## Key message types

| Type | Direction | Purpose |
|------|-----------|---------|
| `CAPTURE_CONTEXT` | BG→Content | Get page DOM snapshot |
| `EXECUTE_ACTION` | BG→Content | Run a single browser action |
| `GET_PAGE_CONTEXT` | Panel→BG | Forward to `getActiveTabContext()` |
| `ASK_ZO` | Panel→BG | Forward to `askZo()` with page context + query |
| `NEW_CONVERSATION` | Panel→BG | Reset `zoConversationId` to null |
| `EXECUTE_ACTIONS` | Panel→BG | Run a batch of actions |
| `GET_CONFIG` | Panel→BG | Return sanitized config (token presence, URL, model) |
| `TEST_CONNECTION` | Panel→BG | Probe Zo API + Zo.space endpoint |

## Known gotchas

- **Host permissions** must include `http://*/*` and `https://*/*` for `scripting.executeScript` to work on arbitrary pages. If the manifest lacks these, context capture fails silently.
- **`output_format`** in `/zo/ask` doesn't support `array` property types — we prompt for JSON and parse from text. This means the model sometimes returns plain text instead of structured JSON, and the sidepanel handles both.
- **Content script injection** happens at `document_idle`. On freshly opened tabs, the content script may not be loaded yet when the side panel first queries — the fallback path handles this.
- **Storage**: `chrome.storage.sync` for config (survives profile sync); `chrome.storage.local` for history (too large for sync, capped at 50 entries).
## Presets system (2026-07-05)

- Built-in presets (Research Deep-dive, Summarizer, Q&A, Data Extraction) are defined in `sidepanel.js` as `BUILTIN_PRESETS`
- Custom presets stored in `chrome.storage.local` under `cobrowse_presets`
- Each preset has: `name`, `description`, `systemPrompt`, `instructions`
- `systemPrompt` replaces the default co-browsing system prompt
- `instructions` replaces the default JSON action schema instructions
- "Create Preset" button (`#create-preset-btn`) sends a `GENERATE_PRESET` message to background, which calls Zo to generate a preset from a user description
- `GENERATE_PRESET` message type + `generatePreset()` in background.js
- `presetSystemPrompt` and `presetInstructions` are passed through `ASK_ZO` to `askZo()`
- Presets are loaded on init via `loadPresets()`
- Presets show in a dropdown with a separator between built-in and custom
- Built-in presets have `deleteBtn` hidden; custom presets can be deleted
