# Conversations

Co-browsing is conversational: you ask in the side panel, Zo answers
in-context, and the browser acts. Two layers of state keep the conversation
intact — one local, one on Zo's side.

## Two layers of state

| Layer | Where | Key / concept | Role |
|-------|-------|---------------|------|
| Local history | `chrome.storage.local` | `zo_cobrowse_history` | What the panel displays; capped at 50 messages |
| Zo thread | background worker | `zoConversationId` | What Zo uses for continuity on its side |

### Local history

The side panel keeps a `conversation` array (local chat history) and persists
it to `chrome.storage.local` under `zo_cobrowse_history`. Messages are stored
in the shape `{ role, text, reasoning, timestamp }` so both the answer and its
thinking re-render when the history loads.

**Why `storage.local`?** History can grow large, and `chrome.storage.sync` has
size limits and syncs across devices. History stays local; only lightweight
settings use `sync`.

### Zo thread continuity

The background worker stores `zoConversationId` — the `conversation_id`
returned by `/zo/ask` — and sends it as `conversation_id` on **every**
subsequent call. Zo respects this, so the thread continues on Zo's side: Zo
remembers the earlier turns in the same session.

## Starting fresh: New Chat

The **New Chat** button performs a full reset:

1. Sets `zoConversationId` to `null` on the worker (breaks the Zo thread)
2. Clears stored local history

After that, the next query starts a brand-new conversation on both layers.

## Storage model

Split between the two Chrome storage areas to respect MV3 constraints and
privacy:

| Area | What lives there |
|------|------------------|
| `chrome.storage.sync` | Non-sensitive settings: model, active mode, theme, enabled menus, TTS prefs, API URL |
| `chrome.storage.local` | Sensitive + bulk data: access token, Zo.space endpoint, conversation history, custom modes |

The config module (`extension/lib/config.js`) is the single source of truth
for keys and defaults, and routes each key to the correct storage area
automatically — sensitive keys (`zoAccessToken`, `zoSpaceEndpoint`) go to
`local`, everything else to `sync`.

## Relevant message types

- `NEW_CONVERSATION` — panel → worker: reset the Zo thread
- `ASK_ZO` — panel → worker: send a query (with current mode + custom modes)
- `GET_CONFIG` — panel → worker: return sanitized config (token presence, URL, model)

See [Message Types](../reference/messages) for the full list.
