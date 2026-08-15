# Tab Contexts — VSCode-style tab references

**Date**: 2026-08-14
**Status**: Approved design (brainstormed with user)
**Related**: tickets/ticket-10-multi-tab.md (this implements the context half; cross-tab actions and tab management stay in the backlog)
**Branch**: feature/prompts follow-on work

## Problem

Today Zo sees exactly one tab — the active one — and only via the context policy's
opt-in/send-once rules (tier-0 URL for reads, tier-N attach for actions /
`!context`). There is no way to say "compare this with what's in my other tab."
Ticket #10's original framing ("capture all tabs into one query") would stuff
every page's text into the prompt — the exact token bloat the context policy
exists to prevent.

## Concept

Tabs become **addressable context objects**, like files referenced in VSCode.
Referencing a tab sends a compact manifest entry + a 500-char excerpt — not the
page text. If Zo needs more, it returns a new `read_tab` action and the
extension auto-attaches the full content as a follow-up turn in the same
conversation. The active tab's existing context-policy path is untouched; tab
contexts are purely additive.

### Decisions (from brainstorming)

| Fork | Decision | Rationale |
|------|----------|-----------|
| Load model | **Hybrid**: manifest + 500-char excerpt + `read_tab` on demand | Excerpt answers many questions with zero round-trips; `read_tab` avoids blind truncation of big pages |
| Reference UX | **Chip strip** above composer, **plus `@` autocomplete** as a keyboard toggler of the same chips | Mouse + keyboard paths; chip strip is the single source of truth (no duplicate inline-pill editing surface) |
| Scope | **Context-only** — no cross-tab DOM actions, no tab management | Keeps blast radius small; ticket #10's action half stays backloged |
| Loop driver | Background chains the `read_tab` follow-up itself | Query loop lives in one place; `buildPrompt` stays the single prompt source |
| Strip membership | **All tabs in the current window, including the active tab** | User chose this; active tab gets a "this tab" marker + a dedup rule |

## Architecture

### New module: `extension/lib/tab-contexts.js` (pure, no `chrome.*`/DOM)

- `buildTabManifest(tabContexts, { activeTabAttached })` → `{ lines, rendered }`:
  assigns refs `T1…Tn` in strip order, renders one manifest line + excerpt per
  tab (see Prompt shape). When the context policy attached the active tab this
  turn (tier ≥ 1), the active tab's line drops its excerpt and reads
  `(attached above)` — content already rides in `## Page Content`.
- `buildTabFollowUp(refData, capture, { textBudget })` → the follow-up `input`
  string for a `read_tab` cycle (see Loop).
- `extractReadTabRequests(actions)` → validated `[{ ref }]` list from Zo's
  action array; unknown shapes ignored.
- Excerpt budget: 500 chars/tab, 8KB total across tabs (later tabs get
  proportionally smaller excerpts, floor 100 chars).

### Prompt: `extension/lib/prompt.js`

- `buildPrompt` / `describePrompt` gain `opts.tabContexts` (array of
  `{ tabId, title, url, textLength, elementCount, excerpt, isActive }`).
- New section `tabs` (`## Referenced Tabs`) between `page` and `content`;
  added to `SECTION_IDS` / `SECTION_LABELS`. Empty `tabContexts` → section
  omitted (byte-identical prompts for today's flows).
- Inspector (`describePrompt`) shows the section with meta (`N tabs`) and it
  feeds `approxTokens` automatically — preview and send can't diverge.
- JSON-mode tail (`ACTION_SCHEMA_COMPACT` in `lib/modes.js`) gains:
  `read_tab {ref}` — "request the full content of a referenced tab".
  Read-only modes get the same capability (it is context, not DOM action).

Prompt shape:

```
## Referenced Tabs
- [T1] "Hacker News" — news.ycombinator.com — ~18k chars text, 210 links — not attached
  > Excerpt: The thread discusses… (500 chars)
- [T2] "PR #123" — github.com — (this tab, attached above)
```

Refs are per-turn (strip order); the ref→tabId mapping lives in extension
state, never in the prompt.

### Sidepanel UI: `extension/sidepanel.js` / `sidepanel.html`

- **Chip strip** (collapsible row above composer): one chip per http/https tab
  in the current window, capped at 10 by recency; active tab included with a
  "this tab" marker. Click toggles. Toggles persist until the conversation
  ends (`NEW_CONVERSATION` resets) or the tab closes. Populated via a new
  `GET_OPEN_TABS` message to background; refreshed on focus/composer focus.
- **`@` autocomplete**: typing `@` in the composer opens the same tab list
  (same capped strip list; fuzzy filter on title/host as you type); selecting
  an entry toggles the matching chip and removes the typed `@…` text from the
  input. The strip is the single source of truth for the referenced set.
- On send: referenced tabs render as mention pills on the user message
  (reusing `appendMentionPill`); the history entry stores `tabRefs`
  (`[{ref, host, title}]`) so pills re-render after reload.
- `read_tab` renders a tool-trace card ("📖 Read tab [T2] github.com · 12k
  chars"); the continuation streams into the same assistant bubble (no new
  user bubble).

### Background: `extension/background.js`

- `GET_OPEN_TABS` handler: `chrome.tabs.query({ currentWindow: true })`,
  filter http/https, sort by lastAccessed, cap 10.
- `GET_TAB_CONTEXTS { tabIds }`: per tab, tier-1 capture via
  `chrome.tabs.sendMessage` with the existing `chrome.scripting.executeScript`
  fallback; returns `{ tabId, title, url, textLength, elementCount, excerpt }`.
  Sidepanel calls this on every send (excerpts are always fresh — cheap).
- **`read_tab` loop**: after `STREAM_DONE` parses actions,
  `extractReadTabRequests` finds requests. For each (in order): capture that
  tab at `min(mode.contextTier, 2)` (screenshots impossible for background
  tabs — `captureVisibleTab` only sees the visible tab), emit a
  `STREAM_TOOL` event (`{ kind: 'tab-read', ref, host, chars }` — the
  existing tool-trace channel, already rendered by the sidepanel), then
  post the follow-up `input` (from `buildTabFollowUp`) to the same
  `conversation_id` via `_askZoStreamImpl` with `isFollowUp: true` +
  the same `sessionId` — the sidepanel appends into the live bubble.
  **Loop guard: max 3 `read_tab` cycles per user turn.** On the 4th request,
  send "(tab-read budget for this turn exhausted — wrap up with what you
  have)" instead of content.
- `ASK_ZO` payload gains `tabContexts` (captured by the sidepanel per send);
  threaded into `buildPrompt` opts.

### State & policy interaction

- Excerpts: re-sent every turn (fresh, no staleness tracking).
- Full `read_tab` content: **send-once per page state** — conversation state
  (`cobrowse_ctx_state`, `extension/lib/context-policy.js`) gains
  `tabsSent: { [tabId]: pageHash }`. A repeat request at the same hash gets
  "(content already provided above)" instead of a re-send. This extends the
  existing send-once philosophy from one tab to N.
- Chip toggles: ephemeral sidepanel memory; not persisted across browser
  restarts. Sent-message `tabRefs` persist in history (max-50 window, same as
  today).

### Error handling

| Failure | Behavior |
|---------|----------|
| Tab closed between toggle and send | Drop the entry; inline note "📎 [T3] tab was closed" on the sent message |
| Capture unreachable (no content script, fallback fails) | Manifest line degrades to `— unavailable, URL only` |
| `read_tab` with unknown/stale ref | Follow-up says "(tab no longer available)" so Zo recovers conversationally |
| Non-capturable schemes (`chrome://`, web store, etc.) | Never listed in strip |
| Active tab both referenced and policy-attached | Dedup: manifest line reads `(attached above)`, no excerpt |

## Data flow (one send)

1. User toggles chips (strip ← `GET_OPEN_TABS` ← `chrome.tabs.query`).
2. Send: sidepanel → background `GET_TAB_CONTEXTS` for toggled tabs (tier-1
   capture → excerpt), and `decideTurn` for the active tab (unchanged).
3. Sidepanel sends `ASK_ZO` with `tabContexts` + `effectiveTier` as today.
4. Background `buildPrompt(mode, pageContext, query, { effectiveTier,
   tabContexts })` → `## Referenced Tabs` + excerpts + `read_tab` protocol.
5. Zo's response streams; `STREAM_DONE` actions may include `read_tab`.
6. Background captures the tab (tier ≤ 2), emits the trace card event, posts
   `buildTabFollowUp` output into the same conversation; continuation streams
   into the same bubble. (Up to 3 cycles.)

## Testing (schema-first, per AGENTS.md)

- New `tests/schemas/tab-contexts.ts`: manifest shape, `read_tab` action
  discriminated union, follow-up builder output, `tabContexts` array shape.
- New `tests/tab-contexts.test.ts`: `buildTabManifest` (ref assignment,
  excerpt budget/floor, dedup line, unavailable degradation),
  `buildTabFollowUp`, `extractReadTabRequests` (happy/unknown/guard).
- Extend `tests/prompt.test.ts`: `tabs` section presence/order, omission when
  empty, inspector meta + token estimate, active-tab dedup.
- Extend `tests/message-contract.test.ts`: `GET_OPEN_TABS`,
  `GET_TAB_CONTEXTS` message types + the `tab-read` `STREAM_TOOL` payload
  (schema ↔ background handler parity is enforced by the existing contract
  test).
- Extend `tests/context-policy.test.ts`: `tabsSent` send-once transitions.
- Extend `tests/modes.test.ts`: `read_tab` in `ACTION_SCHEMA_COMPACT`.
- `bun run verify` must stay green (all files transpile).

## Files to touch

| File | Change |
|------|--------|
| `extension/lib/tab-contexts.js` | NEW — manifest/follow-up/extract logic |
| `extension/lib/prompt.js` | `tabs` section + `opts.tabContexts` |
| `extension/lib/modes.js` | `read_tab` in `ACTION_SCHEMA_COMPACT` |
| `extension/lib/context-policy.js` | `tabsSent` state |
| `extension/background.js` | `GET_OPEN_TABS`, `GET_TAB_CONTEXTS`, `read_tab` loop |
| `extension/sidepanel.js` / `.html` | chip strip, `@` autocomplete, pills, trace card |
| `skill/SKILL.md` (+ `references/`) | document `read_tab` in the action protocol |
| `tests/schemas/tab-contexts.ts` + test files above | contracts first |

## Explicitly out of scope

- Cross-tab DOM actions (`action.tabId` targeting) — ticket #10.
- Tab management (`openTab`/`closeTab`/`switchTab`) — ticket #10.
- Multi-window strips; `!tab` bang command; inline composer pill editing.
- Screenshots of background tabs (impossible without focusing the tab — and
  focusing a tab out from under the user is worse than no screenshot).
