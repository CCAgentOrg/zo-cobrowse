# Zo Co-browse — AGENTS.md

Compact project index for agents working on this codebase.

## Overview

Chrome MV3 extension + optional WebSocket backend that connects the browser to [Zo Computer](https://zocomputer.com) as the AI co-browsing backend. Zo sees the page DOM, uses its full toolchain (DuckDB, skills, web search, files, integrations), and returns browser actions (click, fill, navigate, extract, scroll).

## To understand quickly

- **`extension/background.js`** — entry point for the service worker. All Zo API communication, message routing, config persistence, conversation_id tracking. Key functions: `getActiveTabContext(tabId, tier, modeId)` (CDP eval fast-path via `debugger` perm; capture is **tier-gated** — 0=url only, 1=+text, 2=+clickable+forms w/ selectors, 3=+screenshot), `buildPrompt(mode, pageContext, userQuery)` (single shared prompt assembler), `askZoStream()`/`_askZoStreamImpl()` (primary streaming path), `askZo()` (non-streaming fallback), `executeActions()`, `testConnection()`, `generateMode()` (LLM custom-Mode generator). Top-level helpers: `safePost()`, `isRetriableStreamError()`.
- **`extension/content.js`** — injected into web pages. `captureContext()` extracts URL/title/visibleText/formFields/clickable elements. `executeDomAction()` runs click/fill/extract/scroll/wait/navigate/done in the DOM. Communicates via `chrome.runtime.onMessage` (`CAPTURE_CONTEXT`, `EXECUTE_ACTION`).
- **`extension/sidepanel.js`** — chat UI (~65KB, largest file). Manages conversation history (stored in `chrome.storage.local`, key `zo_cobrowse_history`, max 50 messages). Streaming path: `streamPort` / `handleStreamMessage`, guarded by a per-query `streamSession.sessionId`. Sends `ASK_ZO` (with `modeId` + `customModes`), `GET_PAGE_CONTEXT` (with `tier`), `NEW_CONVERSATION`, `EXECUTE_ACTIONS` to background. Auto-runs pending actions returned by Zo. Mode lifecycle: `loadModes` / `applyMode` / `rebuildModeOptions` / `startModeCreation`. Zo-parity chat surface: composer-shell user bubbles + mention pills, bare assistant prose, inline/collapsible reasoning, tool-trace action cards, per-turn footer (`addMessageFooter` — Copy/mode/model/time/feedback), Zo error card (`addErrorCard` — "Response interrupted" + Retry), Esc-to-cancel stream (`cancelStream()`), Send disabled when empty, relative timestamps (`relativeTime()`). Suppresses raw action-JSON during streaming (`looksLikeActionJson`).
- **`extension/lib/`** — pure ES modules with no `chrome.*`/DOM deps. `modes.js` (`BUILTIN_MODES`, `resolveMode`, `presetToMode`, `ACTION_SCHEMA_COMPACT` — the Mode system, single source of truth for prompt + context tier), `bang-commands.js` (`parseBangCommand()`, discriminated union on `kind`, each command carries a `mode` field), `intent.js` (`detectIntent()`, `shouldDowngradeToJsonDisabled()` — classifies a free-text query as action vs read-only so Co-browse mode answers read-only intents like "Summarize" in plain markdown instead of forcing the JSON action envelope), `config.js` (the `DEFAULTS` config object + storage keys). Unit-tested directly.
- **`extension/options.html`/`.js`** — settings UI. Saves token, API URL, model, Zo.space endpoint to `chrome.storage.sync`. Test connection flow + "Reset to defaults".
- **`backend/relay.ts`** — optional HTTP+WebSocket service for multi-participant sessions. Not required for single-user co-browsing.
- **`extension/AGENTS.md`** — Zo API reference (endpoints, auth, SSE event types). Read before touching API calls in `background.js`.
- **`skill/`** — the Zo-side companion to the extension: co-browse personas, preset library, and the action-schema protocol (`skill/SKILL.md`, `skill/references/presets.md`; presets sync via `skill/scripts/sync-presets.ts`). Presets feed the Mode system through `presetToMode` in `modes.js`.

## Key patterns

- **Two-channel approach**: `/zo/ask` for AI inference + action generation; Zo.space API routes for quick data queries (DuckDB, research).
- **Streaming is the primary path** (`askZoStream` / `_askZoStreamImpl` in background ↔ `streamPort` / `handleStreamMessage` in sidepanel), hardened end-to-end: per-query `sessionId` isolation, `safePost()` that no-ops on dead ports, `port.onDisconnect` → marks `port._dead`, `isRetriableStreamError()` retries only transient errors and emits `STREAM_RECONNECT` before retrying, 60s thinking-indicator liveness timeout. The older non-streaming `askZo()` is retained as fallback. Per-session **SSE shape discovery** (`emitStreamDiagnostic` / `STREAM_DIAGNOSTIC` → `streamShape`) records which event types/fields Zo actually emits (tool traces / sources / streaming reasoning may be dropped today) so the rich-content gap can be closed. See `QA_REPORT.md` § "Streaming support" before touching this path.
- **Conversation threading**: background.js stores `zoConversationId`, sends it as `conversation_id` to every `/zo/ask` call. Zo respects this for thread continuity.
- **Graceful fallback**: content script (`chrome.tabs.sendMessage`) tried first for context/actions; falls back to `chrome.scripting.executeScript` if content script not loaded.
- **No output_format in API calls**: Zo didn't support `array` type in the `output_format` schema. Instead, the prompt asks for JSON and the code parses it from the text response. Only `cobrowse` mode uses the JSON `{reasoning,actions}` envelope; read-only modes (`ask`/`research`/`summarize`/`extract`/`visual`) stream plain markdown.
- **Text safety**: route all output through `addMessageDOM('assistant')` (escapes + markdown + `appendChild`); `safeText`/`String()` coercion at every text sink. Don't use `addMessage('bot')` — it skips markdown.
- **Reasoning — inline, not a separate bubble**: the `reasoning` field Zo returns alongside `actions` is surfaced via `addReasoningBubble(parentMsgEl, reasoning)` in sidepanel.js. Short reasoning renders **inline as muted prose** above the answer; longer reasoning collapses into a "💭 Thought" trace header (Zo model — mirrors Zo's "Response interrupted — retried ▸" pattern). Rendered through `markdownToHtml` + `safeText` (same safety as assistant messages). It no-ops on empty reasoning (so `ask`/`visual` modes are unaffected). Reasoning is persisted with the assistant message (`{role, text, reasoning, timestamp}`) and re-rendered from history. It arrives only in the final `STREAM_DONE` payload (no incremental streaming of reasoning yet).

## Permissions

From `manifest.json`:
- `debugger`, `contextMenus`, `sidePanel`, `storage`, `activeTab`, `tabs`, `scripting`, `tts`
- `host_permissions`: `https://api.zo.computer/*`, `https://*.zo.space/*`, `https://*.zocomputer.io/*`, `http://*/*`, `https://*/*`

> `debugger` is required for the CDP eval fast-path in `getActiveTabContext()`; Chrome shows a standard "is being debugged" banner while it runs. All permissions above are exercised by code paths that have tests.

## Tests & scripts

```bash
bun test              # run the suite (also: npm test)
bun test --watch      # watch mode (npm run test:watch)
bun run verify        # loop-engineering gate → scripts/verify.sh (tests + lint + transpile)
bun run setup-hooks   # one-time: installs the committed pre-commit gate (scripts/install-hooks.sh)
bun run lint          # release-readiness checks → scripts/check-release.sh
bun run package       # zip extension/ → zo-cobrowse.zip
```

[![CI](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml/badge.svg)](https://github.com/CCAgentOrg/zo-cobrowse/actions/workflows/ci.yml)

**386 tests across 21 files (0 failures, 995 expect() calls).** Every extension JS file transpiles cleanly via `bun build` (checked by `bun run verify` and CI). The committed pre-commit hook (`scripts/hooks/pre-commit`) runs `bun run verify` before every commit as a hard gate — bypass with `git commit --no-verify`. CI runs the same checks on every branch push + PR to `main`; tags `v*` trigger the dormant Release workflow (`release.yml`). Adding a feature means adding/updating the corresponding test file under `tests/`. See `QA_REPORT.md` for the audit history.

## Ticket & feature status

- **Shipped tickets (#01–#09, #12, #13, #21-style work):** screenshot/vision, right-click context menu, streaming action timeline, skill runner, NL→DuckDB, keyboard shortcuts, command templates, automations, save-page, onboarding, omnibox.
- **Not started / backlog (#10, #11, #14, #15):** multi-tab context, web store listing, page monitoring, shared sessions. `backend/relay.ts` exists for #15 but extension integration is undone.
- **Streaming architecture:** hardened end-to-end this round (see `QA_REPORT.md` § "Streaming support").

**Authoritative, current status lives in `BACKLOG.md` (feature roadmap) and `QA_REPORT.md` (audit/remediation log).** Per-ticket specs are in `tickets/`. This file is a quick index — update those two docs when status changes rather than maintaining tables here.

> Note: older revisions of this file referenced `brainstorming/ZO_AFFINITY_RANKING.md`; that file does not exist in this repo. The Zo-affinity analysis is summarized in `BACKLOG.md`'s tier table instead.

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
| Change prompt/action schema | `extension/background.js` → `buildPrompt()` + `extension/lib/modes.js` → `ACTION_SCHEMA_COMPACT` + `extension/lib/intent.js` → `detectIntent()` (action-vs-read classification that downgrades JSON modes for read-only queries) |
| Add/edit a Mode | `extension/lib/modes.js` → `BUILTIN_MODES` (add a schema test in `tests/modes.test.ts`) |
| Edit Zo-side presets/personas | `skill/` (`skill/SKILL.md`, `skill/references/presets.md`) |
| Add new action type | `extension/content.js` + `extension/background.js` → `executeDomAction()` |
| Fix context capture | `extension/background.js` → `getActiveTabContext()` |
| Change conversation display | `extension/sidepanel.js` → `addMessage()`, `sendQuery()` |
| Add settings field | `extension/options.html` + `extension/options.js` |
| Update manifest | `extension/manifest.json` |
| Add/modify test | `tests/*.test.ts` |
| Modify backend relay | `backend/relay.ts` |
