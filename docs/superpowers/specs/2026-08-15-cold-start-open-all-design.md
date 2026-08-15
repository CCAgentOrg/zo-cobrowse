# Cold-start (new tab) flow + research answers → "Open all" tabs

**Date**: 2026-08-15
**Status**: Approved design (backlog #27, both halves)
**Related**: docs/superpowers/specs/2026-08-15-auto-active-tab-design.md, 2026-08-14-tab-contexts-design.md, 2026-08-15-chat-tabs-design.md
**Branch**: feature/newtab

## Problem

Two user-visible gaps:

1. **Cold start is broken.** Asking Zo from a new/blank tab (`chrome://newtab`,
   `about:blank`) is the natural research entry point, yet today it:
   - attaches the CDP debugger to the new tab (debug banner) to capture a page
     with no content,
   - auto-references the newtab as a `T1 — unavailable, URL only` manifest line
     (`ensureActiveTabRef` has no URL filtering),
   - renders `## Page — URL: chrome://newtab/` prompt noise, and
   - **hard-blocks the send entirely** when the debugger can't attach
     ("Could not capture page context. Try loading a webpage first.") — the
     user's query is silently dropped.
   Zero blank-URL filtering exists in the codebase; no test covers it.
2. **Research results dead-end in the sidepanel.** A research answer full of
   links can't be acted on: the user copies URLs into the address bar by hand,
   and Zo's follow-up ability (`read_tab` on referenced tabs) never engages.

## Decisions (chosen options)

- **Blank page ⇒ no page context at all.** On a blank active tab, every turn is
  a cold start: no `## Page` section, no T1 auto-reference, no capture attempt
  (no debugger banner), no hard block. The prompt is mode instructions + query.
  Alternatives rejected: a one-line "Active tab: New Tab" pointer (noise),
  URL-only Page header (still noise), sidepanel-only filtering (debug banner
  stays), background-only short-circuit (T1 auto-ref / `!context` still attach).
- **Blank never attaches, explicitly included.** `!context` / manual refresh on
  a blank page also skip — there is nothing to attach; the decision reason says
  so (`Blank page · no page context`).
- **Open all (N): first tab foreground, rest background.** Single chip clicks
  open foreground.
- **Opened tabs auto-become reference chips** for the active chat (the
  synergy: `read_tab` follow-ups on what Zo found).
- **No confirm cap, no per-chip status, no param stripping** (owner decision
  2026-08-15). Display/open cap is `MAX_LINK_CHIPS = 10`.

## Changes

### Part 1 — cold start

1. **`lib/tab-contexts.js`** — new pure predicates (peers of `hostOf`):
   - `isBlankPage(url)` — empty/missing url, `about:blank`, `about:newtab`,
     `chrome://newtab`, `chrome://new-tab-page` (scheme+host match, so trailing
     slashes/queries/case don't matter).
   - `isCapturableUrl(url)` — `/^https?:/i`; replaces the inline regex in
     `GET_OPEN_TABS` so chip strip and capture agree.
   - `ensureActiveTabRef` ignores a blank `activeTabCtx` (reference-stable
     no-op, same contract as null).
   - `buildTabFollowUp` gains reason `'blank'` — "(that tab is on a blank/new-tab
     page — nothing to read)".
2. **`lib/context-policy.js#decideTurn`** — new optional `pageBlank` input:
   forces `attach=false` (even for `!context`/`forceRefresh`), tier 0, reason
   `Blank page · no page context`; `lastCaptureHash` is NOT recorded (the
   non-attach state branch), so the first action turn on a later real page
   still attaches.
3. **`lib/prompt.js#_compose`** — omits the whole `## Page` section when the
   url is missing or `isBlankPage`. `describePrompt` shares `_compose`, so the
   inspector preview can't drift.
4. **`background.js`** — `getActiveTabContext` short-circuits blank urls to
   `{ url, title, tabId }` before any capture path (no debugger, no doomed
   injections, no screenshot); `getTabContexts` skips the capture for blank
   urls (degraded `available:false` base); the `read_tab` loop treats a
   `capture.blank` result as unreadable → follow-up reason `'blank'`;
   `GET_OPEN_TABS` uses `isCapturableUrl`.
5. **`sidepanel.js`** — `sendQuery` passes `pageBlank` into `decideTurn` and
   skips the tier-0 auto-reference + the user-message mention pill for blank
   pages; the inspector passes the same `pageBlank` (preview parity).
   `refreshPageContext` is unchanged — the blank context is truthy now, so the
   hard block only fires on genuine capture failures of capturable pages.

Zo can still `navigate` from a cold start (navigate needs no page context);
DOM actions fail gracefully as today. Context menu / omnibox funnel through the
same `sendQuery`, so they are fixed for free.

### Part 2 — link chips + Open all

1. **`lib/links.js`** (new, pure) — `extractUrls(text)`: strips fenced code
   blocks, matches markdown links `[t](url)` and bare URLs (same scheme +
   char-class rules as `markdownToHtml`'s autolink), http/https only, dedupes
   by exact URL (first occurrence wins), returns `[{ url, host }]` via
   `hostOf`. Exports `MAX_LINK_CHIPS = 10`.
2. **`sidepanel.js`** — `addLinkChipsCard(parentMsgEl, urls)` (modeled on
   `addReasoningBubble`: idempotent, attached inside the assistant bubble):
   `🔗 N links` header, one chip per URL (label = host, title = full URL,
   click opens foreground), `Open all (N)` button → `openAllLinks(urls)`:
   `chrome.tabs.create` ×N (first `active:true`, rest `active:false`), then
   every created tab is added to the active chat's tab-ref set and the strip
   refreshes. Card threshold: ≥ 2 unique URLs (a single link is already
   clickable in the rendered markdown).
   Triggers: STREAM_DONE prose answers without actions, the non-stream
   fallback branch, and history re-render (re-derived from the persisted text —
   nothing new is persisted; auto-referencing only fires on Open all).

## Out of scope

- Confirm-before-open above a cap, per-chip open status, tracking-param
  stripping (declined this round).
- Structured `open_urls` action in the JSON envelope (later option per #27).
- Blank-page awareness in `modes.js` system prompts (no hint line — Zo sees no
  `## Page`, which is the signal).
- Cross-tab DOM actions (still ticket #10).

## Testing

- `tests/tab-contexts.test.ts` — `isBlankPage`/`isCapturableUrl` truth tables;
  `ensureActiveTabRef` blank no-op (reference-stable); `buildTabFollowUp`
  `'blank'` kind; updated source-wiring regexes for the new sidepanel gate.
- `tests/context-policy.test.ts` — `pageBlank` forces no-attach (read, action,
  `!context`, forceRefresh), hash not recorded, first real-page action later
  still attaches.
- `tests/prompt.test.ts` — blank/empty context omits `## Page` (replaces the
  empty-fields assertion); tier sections unaffected otherwise.
- `tests/background.test.ts` + `tests/tab-contexts.test.ts` — source asserts:
  blank short-circuit before the debugger path, `getTabContexts` skip,
  tab-loop blank handling, `GET_OPEN_TABS` uses the shared helper.
- `tests/schemas/links.ts` + `tests/links.test.ts` — extraction truth table
  (markdown links, bare URLs, dedupe, scheme filter, code fences, cap).
- `tests/sidepanel.test.ts` — `addLinkChipsCard` DOM behavior (idempotence,
  threshold, chips, Open all wiring) with `chrome-mock` recording
  `tabs.create` calls; blank-gate wiring asserts.
- `tests/helpers/chrome-mock.ts` — `tabs.create` call recording.
