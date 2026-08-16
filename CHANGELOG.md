# Changelog

All notable changes to Zo Co-browse are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — #24 Context-on-demand (pull protocol)

- **Three new context-only actions** — `read_page`, `get_dom`, `get_form`. When
  Zo needs the complete version of the current page's context (full page text
  ~12k chars, the complete interactive-element map, or every form field), it
  emits a pull action instead of guessing from the budget-sliced prompt
  excerpt. The extension captures the requested context and auto-sends it back
  into the conversation as a `## Auto-fetched:` follow-up turn, then Zo continues
  with it. All inside the same stream, before STREAM_DONE.
- **`lib/pull.js`** — the generalized pull mechanism: `extractPullRequests()`,
  `buildPullFollowUp()` (with compact `read_page` / `get_dom` / `get_form`
  serializers + render caps), `pullHash()` (send-once per `kind:page-hash` —
  re-asking an unchanged page returns "already provided above"), and
  `pullTier()`/`pullCaptureOpts()` (capture-shape hints threaded through
  `getActiveTabContext` → `CAPTURE_CONTEXT`).
- **`finishStreamWithPullLoop`** — generalizes the `read_tab` follow-up loop to
  all four pull kinds. Shares the same 3-cycle budget (`MAX_PULL_CYCLES` =
  `MAX_READ_TAB_CYCLES`) so a single user turn can mix reads and pulls without
  runaway round-trips. A tool-trace card (`emitPullTrace` on `STREAM_TOOL`)
  renders the pull in the live bubble.
- **`CONTEXT_ACTION_NAMES` + `isContextAction`** — single source of truth for
  "context-only, never reaches `executeDomAction`". Applied at every executor
  gate (background `EXECUTE_ACTIONS`, sidepanel `STREAM_DONE` + pending-actions
  filter). This also closes a latent bug where a canonical `{type:'read_tab',
  ref:'T1'}` from Zo was silently dropped by `normalizeActions` (it survived
  only in key-first form).

### Changed
- **Capture caps respond to pull hints** — `captureContext(tier, {pull})` and
  `getActiveTabContext(tabId, tier, modeId, {pull})` raise the text budget
  (`read_page`) and element caps (`get_dom`, `get_form`) only on demand;
  normal prompt capture keeps its 30-field / 50-clickable / 8k-char budget.

### Tests
- `tests/pull.test.ts` (16 tests) + `tests/schemas/pull.ts` (protocol schemas
  for `PullRequest`, `FollowUp`, `PullCapture`). Updated
  `tests/schemas/actions.ts` with `ReadPageAction` / `GetDomAction` /
  `GetFormAction` (now 11 action types). Integration: a full
  sidepanel↔background↔content round-trip asserts the loop fires inside the
  stream and `get_form` never reaches the DOM executor. E2E: `e2e/07-pull.spec.ts`
  runs the round-trip in a real Chromium against the mock Zo server.
- **Suite: 791 tests / 0 fail (34 files, 2070 expect calls) + 16 Playwright E2E specs.**

### Added — #25 Vision-gated screenshots

- **`lib/vision.js`** — the vision gate: tier-3 screenshot capture now checks
  `/models/catalog`'s `supports_images` for the selected model. A known
  non-vision model skips the `captureVisibleTab` round-trip and the base64
  data-URL prompt bloat (pure token waste); unknown support keeps capturing
  (backward-compatible — tier 3 worked before this gate existed). Pure
  functions: `findModelEntry`, `modelVisionSupport`, `shouldCaptureScreenshot`,
  `catalogIsStale` (5-min TTL), `visionModelSuggestion`.
- **`fetchModelCatalog()` + `GET_VISION_CATALOG`** — the background fetches the
  no-auth model catalog, caches it for 5 min (in-flight dedup), and serves it
  to the sidepanel for the suggestion UI.
- **Visual-mode suggestion** — picking Visual mode with a known non-vision
  model surfaces a system message suggesting a vision-capable model from the
  catalog (or a warning when none exists).
- **Mode hot-reload fix** — the sidepanel now syncs `activeModeId` when
  `zoActiveMode` changes in storage (another tab's mode change previously
  didn't reflect until reload).

### Tests (#25)
- `tests/vision.test.ts` (21 unit tests) + 2 integration round-trips
  (gate suppresses capture for `supports_images:false`; captures for `:true`).
- Mock Zo server serves `/models/catalog` with `supports_images` per model.
- **Suite: 790 tests / 0 fail (34 files) + 15 Playwright E2E specs.**

## [v0.0.2] - 2026-08-10

Stable release: streaming stability + conversation-experience work promoted
from `dev` (PR #18) with the VitePress docs site (PR #19). Suite: **534 tests /
0 fail** (24 files, 1381 expect calls).

### Added
- **Repo maintenance rules + git-flow model** — formalized a `dev` (integration)
  → `main` (release) branching model with branch protection on both: no direct
  pushes, CI must be green to merge. CI now gates PRs into `dev` as well as
  `main`. Feature/fix/chore branches flow into `dev`, which promotes to `main`
  via PR. Releases remain deliberate (`git tag vX.Y.Z` triggers `release.yml`).
  Documented in `CONTRIBUTING.md` § "Branching model" and `AGENTS.md`.
- **Thinking/reasoning bubble** — `reasoning` returned by Zo surfaces as a
  collapsible "💭 Thinking" bubble above the assistant message, persisted with the
  message and re-rendered from history. (no-op when the backend sends none)
- **zo.computer-style chat UI** — read-only modes (`ask`/`research`/`summarize`/
  `extract`/`visual`) stream **plain markdown** instead of forcing the
  `{reasoning,actions}` JSON envelope, so thinking and answer render as separate
  blocks (fixes the raw-JSON-in-chat bug). Only `cobrowse` keeps the JSON action
  protocol.
- **Inline grouped action timeline** — DOM actions render as a grouped, sticky
  timeline with per-action status (pending → running → done).
- **Reset-to-defaults** in the options page (clears sync + local config).
- **Mode system unification** — `ACTION_SCHEMA_COMPACT` requests only
  `{"actions":[...]}`; lite vs full context tiers stay consistent.
- **Loop-engineering tooling** — `bun run verify` (tests + release checks +
  per-entry transpile) and a committed **hard-gate pre-commit hook** (`bun run
  setup-hooks` to install; `git commit --no-verify` to bypass).
- **CI/CD backbone** — CI now runs on every branch push + PR to `main` (tests,
  transpile check, release checks, package artifact); a dormant tag-triggered
  `Release` workflow is ready to publish `v*` releases with the extension zip.

### Changed
- Streaming path hardened end-to-end: `sessionId` echoed on every `STREAM_*`
  message, stale-port `safePost()` no-throw, retries gated to transient errors
  (`isRetriableStreamError`), 60s thinking-indicator liveness timeout, no silent
  `fullText` clobbering, `STREAM_DONE` normalized to canonical `responseText`.
- Top region of the panel is sticky — only `#messages` scrolls.
- Removed dead duplicate `sendQuery`; action loop snapshots pending actions
  against the Skip race.

### Fixed
- **P0**: `addSystemMessage` XSS + markdown bypass + DOM thrash; context-menu
  crash (`pageContext` ReferenceError); Lite persona dropdown permanently empty;
  `enabledMenus` key mismatch hiding "Fill this field".
- **P1**: streaming port disconnect lifecycle, late-DONE cross-query rendering,
  `enabledMenus` not loaded on service-worker startup, missing `navigate`/`done`
  cases in content.js, wrong keyboard-shortcut docs (options.html).
- **P2**: `fullText` overwritten by final payload, `captureVisibleTab`
  undefined window, NAVIGATE undefined tabId, `testConnection` casing,
  hardcoded API hosts, orphan storage keys, sandbox `'unsafe-eval'` CSP,
  `zoTtsRate` stored as string.
- **P3**: `addMessage('bot')` markdown bypass, unstyled action timeline/DuckDB
  tables, badge showing `undefined` persona, dead action handler, uncaught
  `storage.session.set` promise.
- Persisted history that showed raw JSON blobs is healed on load; key-first
  actions are normalized so reasoning bubbles + done text render.

### Tests / QA
- Suite grown from 81 → **534 tests / 0 fail** (24 files, 1381 expect calls).
- New test files: `action-timeline`, `normalize-actions`, `css-layout`,
  `sse-parsing`, `strict-module`, plus options/reset and shortcut-docs coverage.
- Full P0–P3 audit round closed — see `QA_REPORT.md` for the remediation log.

---
*Pre-tag history (initial MV3 extension + first-round features: side panel,
context menu, keyboard shortcuts, bang commands, screenshots, DuckDB, skills,
automations, save-page, onboarding, presets, themes, omnibox, relay) is inline
in the git history; versioned sections begin at the first tagged release.*

[v0.0.2]: https://github.com/CCAgentOrg/zo-cobrowse/compare/v0.0.1-alpha...v0.0.2
