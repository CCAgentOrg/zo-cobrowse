# Using Co-browse

The side panel is the main chat surface, modeled after Zo's own conversation
UI: composer-shell user bubbles with mention pills, bare assistant prose,
inline thinking, tool-trace action cards, and a per-turn footer with
Copy / mode / model / time / feedback controls.

## The chat surface

- **Composer** — type a query; the Send button stays disabled until you type
  something.
- **Assistant messages** — rendered as escaped Markdown (nothing is injected
  as raw HTML).
- **Thinking** — when Zo returns a `reasoning` field alongside actions, it
  renders as muted inline prose for short reasoning, or collapses into a
  "💭 Thought" trace for longer reasoning.
- **Action cards** — browser actions surface as a grouped, sticky timeline
  with per-action status (pending → running → done).
- **Per-turn footer** — Copy, mode, model, timestamp (relative), and feedback
  on every assistant message.
- **Cancel** — press `Esc` while Zo is responding to interrupt the stream.

## Bang commands

Type `!` in the composer to trigger quick commands. `!help` lists them inline:

| Command | Description |
|---------|-------------|
| `!summarize` | Condense the page into a concise summary |
| `!extract [what]` | Extract structured data (tables, lists, contacts, prices) |
| `!research [topic]` | Deep research on the page topic |
| `!qa <question>` / `!ask` | Answer a specific question about the page |
| `!fill [details]` | Ask Zo to fill editable fields on the page |
| `!skills` | List available Zo skills |
| `!skill <name>` | Run a Zo skill on the current page |
| `!autos` | List your scheduled Zo automations |
| `!save [path]` | Save this page to your Zo workspace as Markdown |
| `!query <question>` / `!data` | Natural-language DuckDB query against your datasets |
| `!auto <instruction>` | Create a scheduled Zo automation from the current page |
| `!help` | Show this list |

Mode commands (`!summarize`, `!extract`, `!research`, `!qa`) set the active
[Mode](../guide/modes) for a single turn. Others (`!skill`, `!query`, `!auto`)
open Zo's tooling directly.

## Right-click context menu

Enabled menus are configured in Options. Right-click a page, a selection, a
link, or an editable field to run quick actions without opening the panel:

- **Page** actions — summarize, extract, and more
- **Selection** actions — ask Zo about the selected text
- **Link** actions — ask Zo about a link
- **Editable** — "Fill this field"

Each menu entry can be toggled on/off in Options → Enabled menus.

## Theming

The panel supports the Zo-native **themes**: system, light, dark, sepia,
forest, and ocean. Use the theme toggle to cycle, or let it follow
`prefers-color-scheme`. Your theme is persisted across sessions.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+Z` (⌘⇧Z) | Open the side panel |
| `Ctrl+Shift+S` (⌘⇧S) | Summarize the current page |
| `Ctrl+Shift+N` (⌘⇧N) | Start a new chat |
| `Ctrl+Shift+E` (⌘⇧E) | Extract structured data from this page |

## Omnibox

Type `zo` in the address bar and hit space to run commands from the omnibox
(e.g. `zo summarize this page`).

## Context capture

When you ask a question, the extension captures **page context** from the
active tab at a **tier** determined by the active mode:

| Tier | What's sent |
|------|-------------|
| 0 — Pointer | URL, title, viewport only |
| 1 — Text | + visible text (sliced to the mode's text budget) |
| 2 — Elements | + compact clickable + form-field list **with selectors** |
| 3 — Screenshot | + a page screenshot |

Co-browse (the default) runs at tier 2, so Zo gets clickable elements and form
fields with selectors to act on. The Visual mode runs at tier 3. See
[Modes](../guide/modes) for the full mapping.

## Conversation history

- Chat history is stored locally in `chrome.storage.local` (key
  `zo_cobrowse_history`, capped at 50 messages) for continuity.
- Zo's `conversation_id` is tracked by the background service worker and sent
  on every `/zo/ask` call so the **thread** continues on Zo's side too.
- **New Chat** clears both: it resets the Zo thread and clears stored history.

## Error handling

When a stream is interrupted, Zo Co-browse shows a **"Response interrupted"**
card with a **Retry** button — the extension retries only transient errors and
never silently drops the answer. See [Streaming](../concepts/streaming) for the
full resilience design.
