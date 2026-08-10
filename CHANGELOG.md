# Changelog

All notable changes to Zo Co-browse are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project uses [Semantic Versioning](https://semver.org/).

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
