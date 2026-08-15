# Chat Tabs — multiple conversations open at once + chat management

**Date**: 2026-08-15
**Status**: Approved design (plan approved in-session)
**Related**: tickets/ticket-10-multi-tab.md (browser-tab half stays backloged; this is the *chat* tab surface)
**Branch**: feature/tab-interface

## Problem

The sidepanel has a conversations store (`cobrowse_convos`) and a history view
(list / switch / delete / auto-title), but only one chat is "open" at a time and
switching is a detour through the history list. Worse, three globals make even
sequential switching semantically wrong:

1. `zoConversationId` is a single background global — switching chats silently
   continues the *previous* chat's Zo server thread (context bleed).
2. `cobrowse_ctx_state` (page-hash dedup, `tabsSent`) is one shared state —
   send-once dedup leaks across chats.
3. Switching cancels the in-flight stream — "don't change chats while Zo
   thinks".

And the history view cannot rename or search.

## Concept

A browser-style **tab bar** under the header: several conversations open at
once, click to switch, ✕ to close (at least one stays open), middle-click to
close. Each conversation carries its own **Zo thread id** and its own
**context-policy state**, so tabs are real isolated threads, not one shared
session wearing different titles. One in-flight stream at a time (the composer
is single), but the stream **survives tab switches**: it keeps accumulating
into its own conversation in the background and the finishing actions wait as
pending-actions for when the user returns.

### Decisions

| Fork | Decision | Rationale |
|------|----------|-----------|
| Tab bar vs quick-switcher | **Tab bar** (persistent open set) | "Multiple tabs in cobrowse" — visible, ordered, closeable; quick-switcher can't show two live chats side by side |
| Thread identity | **Per-conversation `zoThreadId`**, ASK_ZO carries `chatId` + `conversationId` | Fixes cross-chat bleed; background stays stateless about chats (id rides the payload, latest id echoed back in STREAM_DONE) |
| Streaming on switch | **Stream survives; routes by chat id** | Killing a generation because the user peeked at another chat is hostile; one stream max keeps port/session model unchanged |
| Background-chat actions | **Not auto-run** — stored as `conv.pendingActions`, restored when the chat becomes active | Auto-clicking pages for a chat the user isn't looking at is unsafe; the Run All/Skip bar already exists |
| Context/tab-ref state | **Per-chat keys** (`cobrowse_ctx_state:<chatId>`); toggles in an in-memory map | Dedup is per-thread by design; no migration (cache only, orphaning the legacy global key is harmless) |
| Manage chats scope | **Rename + search** in history view | List/switch/delete/auto-title already ship; pin/export are follow-ups (YAGNI) |
| Open-set cap | **8 tabs**, LRU-evict oldest non-active on overflow | Sidepanel is ~360px; a scrollable bar with a bound beats unbounded DOM/storage growth |

## Architecture

### New module: `extension/lib/chat-tabs.js` (pure, no `chrome.*`/DOM)

- Knobs: `MAX_OPEN_TABS = 8`, `TITLE_MAX = 60`.
- Tab-set state `{ openIds: string[], activeId: string }`, always spread-copied:
  - `createTabsState()` — `{ openIds: [], activeId: null }`
  - `openChatTab(state, chatId, { maxOpen })` — idempotent open + activate;
    evicts the oldest non-active id when over cap (evicted chats stay in history)
  - `closeChatTab(state, chatId)` — no-op on the last open tab; else removes and
    activates the right neighbor (or the previous one for the tail)
  - `activateChatTab(state, chatId)` — no-op on unknown ids
  - `pruneChatTabs(state, existingIds)` — drops open ids whose conversations no
    longer exist, re-activating a survivor if the active one was dropped
  - `tabTitleFor(convo)` — title (or "New Chat"), capped at TITLE_MAX
- Management ops:
  - `renameConversation(convos, chatId, title)` — trim, cap 60, empty → no-op;
    returns `{ convos, changed }`
  - `searchConversations(convos, query)` — case-insensitive substring match on
    title + any message text; returns updatedAt-sorted summaries (same shape as
    today's `listConversationSummaries`)

### Conversation object

Gains two optional fields (persisted in `cobrowse_convos`, not sensitive):

- `zoThreadId?: string` — the Zo server thread id for this chat
- `pendingActions?: { reasoning, actions }` — actions that finished streaming
  while the chat was in the background

### Sidepanel UI: `extension/sidepanel.js` / `sidepanel.html`

- `<div id="chat-tabs" role="tablist">` between header and page bar; tabs are
  rendered buttons (`renderChatTabs()`) with truncated title + ✕, active
  highlight, a pulsing dot on a background-streaming chat, middle-click close.
  Re-rendered on every conversation mutation (create/switch/close/delete/
  rename/auto-title).
- `openIds` persist in `chrome.storage.local` next to `cobrowse_active_id`
  (written by `saveConversations()`); default on upgrade = `[activeId]`.
- History view: `#history-search` input filters live (empty state "No matching
  chats."); ✎ per card starts an inline rename (Enter/blur saves, Esc cancels).
- Ctrl+Shift+N fix: sidepanel listens for the `NEW_CONVERSATION` shortcut
  message (background already sends it; nothing consumed it) → `startNewConversation()`.

### Per-chat threading

- `ASK_ZO` payload (streaming port + fallback) gains `chatId` (local conv id)
  and `conversationId` (`conv.zoThreadId || undefined`).
- Background `_askZoStreamImpl` / `askZo`: request body uses
  `msg.conversationId ?? zoConversationId`; every capture point (JSON
  `conversation_id`, `x-conversation-id` header) still updates the global
  (ambient/omnibox fallback) **and** echoes the id back — `STREAM_DONE.conversationId`
  and the non-streaming response field. `read_tab` follow-up cycles re-enter
  with the latest captured id (`_loop.threadId`) so continuation stays on the
  thread even if Zo rotated it mid-loop.
- Sidepanel STREAM_DONE handler persists `conv.zoThreadId = msg.conversationId`.
- Old chats (no stored id): first send starts a fresh thread — history was
  display-only before, so nothing regresses.
- `NEW_CONVERSATION` background handler stays (ambient callers); the sidepanel
  keeps sending it on ✚.

### Stream routing

- `streamSession` gains `chatId`. `handleStreamMessage` gates DOM work on
  `streamSession.chatId === activeId`:
  - active chat: exactly today's behavior
  - background chat: accumulate `fullText`/`reasoningText`, skip DOM; on
    STREAM_DONE persist the assistant message into that conversation
    (`addMessage` refactored to take an optional conversation id), store
    actions as `conv.pendingActions`, skip auto-run
- Switching **to** the streaming chat re-creates the live bubble from
  `streamSession.fullText`/`reasoningText` and restarts the timer; switching to
  a chat with `pendingActions` restores the Run All/Skip bar (Run/Skip clears
  the field and saves).
- Esc still cancels the single global session from any tab.

### Context + tab-ref state

- `lib/context-policy.js`: `loadConversationState(chatId)` /
  `saveConversationState(chatId, state)` on `cobrowse_ctx_state:<chatId>`;
  `state.conversationId` (reserved field, previously dead) is set to the chat
  id. Callers without a chatId (legacy) fall back to the old global key.
- Background's `read_tab` loop loads/saves by `msg.chatId`.
- Tab-ref chip toggles (`tabRefsEnabled`): in-memory `Map<chatId, Set<tabId>>`,
  saved/restored on switch, not persisted (tab ids are volatile; sent pills
  already persist on messages).

### Error handling

| Failure | Behavior |
|---------|----------|
| Delete a chat that is open as a tab | Tab pruned; neighbor activates (existing delete fallback logic aligned with `closeChatTab`) |
| Rename to empty/whitespace | No-op, previous title kept |
| Search matches nothing | "No matching chats." empty state |
| Over 8 opens | Oldest-position non-active tab evicted silently (chat stays in history) |
| Stream errors in a background chat | Standard error message persisted into that conversation; tab dot clears |
| Two sidepanel windows | Pre-existing last-write-wins on `cobrowse_convos` — unchanged, noted as follow-up |

## Testing (schema-first, per AGENTS.md)

- New `tests/schemas/chat-tabs.ts`: `TabsStateSchema`, `ChatSummarySchema`,
  `ConversationSchema` (with `zoThreadId`/`pendingActions`, `.passthrough()`),
  `RenameResultSchema`.
- New `tests/chat-tabs.test.ts`: tab ops (idempotent open, LRU cap, last-tab
  guard, prune), rename validation, search filtering — `expectValid` against
  the schema; plus wiring contracts (`#chat-tabs`/`#history-search` in HTML,
  `chatId`/`conversationId` in both ASK_ZO payloads, `zoThreadId` persist on
  STREAM_DONE, background `msg.conversationId ?? zoConversationId`).
- Extend `tests/context-policy.test.ts`: keyed helpers + legacy fallback.
- Extend `tests/sidepanel.test.ts`: new elements + per-chat state wiring.
- `bun run verify` stays green.

## Files to touch

| File | Change |
|------|--------|
| `extension/lib/chat-tabs.js` | NEW — pure tab/management ops |
| `extension/lib/context-policy.js` | keyed per-chat state helpers |
| `extension/background.js` | payload ids, thread echo, per-chat ctx keys in read_tab loop |
| `extension/sidepanel.js` / `.html` / `styles.css` | tab bar, stream routing, rename/search, shortcut fix |
| `tests/schemas/chat-tabs.ts`, `tests/chat-tabs.test.ts` | NEW contracts |
| `tests/context-policy.test.ts`, `tests/sidepanel.test.ts` | updates |
| `AGENTS.md`, `BACKLOG.md`, `QA_REPORT.md` | status docs |

## Explicitly out of scope

- Zo browser-tab management (`openTab`/`closeTab`/`switchTab`) and cross-tab
  DOM actions — ticket #10's open half.
- Concurrent streams (multiple simultaneous generations).
- Multi-window `storage.onChanged` sync for `cobrowse_convos`.
- Pin/export chats; conversation pruning/quota management.
