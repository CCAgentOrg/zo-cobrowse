# Auto-reference the active tab — reads always know what page you're on

**Date**: 2026-08-15
**Status**: Approved design (option chosen in-session)
**Related**: docs/superpowers/specs/2026-08-14-tab-contexts-design.md, docs/superpowers/specs/2026-08-14 prompts round (opt-in DOM), 2026-08-15-chat-tabs-design.md
**Branch**: feature/tab-interface

## Problem

Two user-visible gaps:

1. **Nothing reacts to browser-tab switches.** No `chrome.tabs.onActivated`
   listener exists; the sidepanel refreshes page context only at send time.
   After switching browser tabs and creating a new chat, the page bar,
   prompt inspector, and 📎 strip still describe the *previous* tab — it
   looks like the new chat is bound to the old page.
2. **Read turns send URL/title only** (the prompts round's opt-in design), so
   a read question in a fresh chat carries nothing about the page content.
   Zo literally can't "summarize this page" without `!context`.

## Decision (chosen option)

**Auto-reference the active tab on every tier-0 turn.** Whenever the context
policy thins the turn to tier 0 (reads, same-page follow-ups — i.e. any turn
where the page content itself is NOT attached), the active browser tab rides
along automatically as a referenced tab (T1): one manifest line + 500-char
excerpt (~600 chars), captured via `GET_TAB_CONTEXTS` (content-script path,
`skipDebugger` — no "being debugged" banner). Full DOM stays opt-in
(`!context`, action turns). Alternatives rejected: full-context-every-turn
(reverts the token-efficiency design), staleness-fix-only (reads still blind).

Uniform rule: **whenever the page content isn't attached, the active tab
rides as a reference.** Zo knows what page you're on and gets a peek;
`read_tab` escalation already exists (send-once per page-hash, per chat).

## Changes

1. **`background.js#getActiveTabContext`** returns `tabId` on the captured
   context. Root-cause fix: `currentContext.tabId` was always `undefined`,
   so `GET_TAB_CONTEXTS` always got `activeTabId: null` and the manifest's
   `isActive` dedup ("this tab, attached above") could never fire.
2. **`lib/tab-contexts.js#ensureActiveTabRef(tabContexts, activeTabCtx)`** —
   pure: prepend the active tab unless its tabId is already referenced
   (user-toggled chips keep their strip-order refs). No-op on null inputs.
3. **`sidepanel.js#sendQuery`**: after `decideTurn`, when
   `effectiveTier === 0`, fetch the active tab's TabContext
   (`GET_TAB_CONTEXTS`, banner-free) + `ensureActiveTabRef`; the result rides
   the `## Referenced Tabs` manifest. No extra pill on the user message (the
   page-mention pill already represents the active page) and nothing extra is
   persisted to `tabRefs` — only explicit toggles do.
4. **Preview parity**: `previewTabContexts({ includeActive })` appends the
   active tab (from `openTabs`/`currentContext` metadata, zeroed excerpt —
   same approximation as toggled tabs today) when the previewed decision is
   tier 0, so the inspector shows exactly the auto-attach that would fire.
5. **Staleness fixes (display-only, never the debugger)**: the sidepanel
   listens to `chrome.tabs.onActivated` and refreshes `currentContext` from
   `chrome.tabs.get` (url/title/tabId — no capture, no banner), updating the
   page bar, strip, and inspector; `startNewConversation()` runs the same
   lightweight refresh so a new chat describes the current browser tab
   immediately. The full Mode-tier capture still happens at send time only.

## Interaction with existing behavior

| Turn | What rides to Zo |
|------|------------------|
| Read / same-page follow-up (tier 0) | URL/title + **auto T1** (manifest line + excerpt) |
| `!context` / action first-turn / page-change (tier ≥ 1) | Full Mode-tier context; no auto T1 (content already attached; existing dedup line if the user also toggled it) |
| `read_tab` on the auto T1 | Full content once per page-hash per chat (`tabsSent`) |

## Testing

- `ensureActiveTabRef` unit tests (prepend, dedupe by tabId, null-safety).
- Wiring contracts: `effectiveTier === 0` auto-attach + `ensureActiveTabRef`
  in sidepanel; `onActivated` listener; `tabId` in the
  `getActiveTabContext` return; preview `includeActive` mirror.
- `bun run verify` green.

## Explicitly out of scope

- Auto-referencing background tabs (only the active tab).
- Same-tab navigation staleness (`tabs.onUpdated`) — send-time capture
  already handles correctness; can add later if the page bar bothers anyone.
- Making the auto-reference a visible, dismissible chip.
