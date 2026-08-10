# Development Setup

Zo Co-browse uses **Bun** as the runtime/test runner (no Node required for the
extension itself), plus a committed pre-commit verification gate. This guide is
for developers extending the project — see [Contributing](../contributing) for
the full contribution workflow.

## Prerequisites

- **Bun** ≥ 1.x — install from <https://bun.sh>
- **Chrome** (for loading the extension + manual QA)
- A **Zo** account + API token (see [Getting Started](../guide/getting-started))

## First-time setup

```bash
git clone https://github.com/CCAgentOrg/zo-cobrowse.git
cd zo-cobrowse
bun install          # installs zod + bun-types (test deps only)
bun run setup-hooks  # one-time: installs the pre-commit verification gate
bun test             # sanity: all tests pass
```

Load `extension/` as an unpacked extension in Chrome
(`chrome://extensions` → Developer mode → **Load unpacked**).

## Branching model

The repo follows a git-flow-style model with two protected long-lived branches:

```
main   (protected)  ← always the latest working release code; releases cut here
  ▲
  │  PR (CI must be green)
  │
dev    (protected)  ← integration branch; features merge here
  ▲
  │  PR (CI must be green)
  │
feature/*  fix/*  chore/*   ← one branch per unit of work, branched from dev
```

**Start every change from `dev`:**

```bash
git checkout dev && git pull
git checkout -b feature/<short-description>
```

## The development loop

This repo is set up for **loop engineering**: every change is verified before
it is committed, and `bun run verify` is the single gate:

```bash
bun run verify   # = tests (bun test) → release checks (lint) → transpile check
```

- The **pre-commit hook** (installed by `bun run setup-hooks`) runs
  `bun run verify` on every `git commit` and **blocks the commit** if anything
  fails. No husky needed.
- The hook is a hard gate — to bypass deliberately: `git commit --no-verify`.
- CI runs the same checks on every branch push and on PRs into `main` and
  `dev` (`ci.yml`).

## Project structure

```
zo-cobrowse/
├── extension/          # Chrome extension (service worker, side panel, options)
│   ├── lib/            # Pure ES modules (modes, config, intent, bang-commands)
│   ├── icons/          # Extension icons (16, 48, 128)
│   ├── sidepanel.html  # Co-browse side panel UI
│   ├── background.js   # Service worker (Zo API calls, action execution)
│   ├── content.js      # Content script (DOM capture, action dispatch)
│   ├── options.html    # Options page (API URL, model, persona)
│   └── manifest.json   # Chrome extension manifest (V3)
├── docs/               # This documentation site (VitePress)
├── tests/              # Bun test suite
│   ├── schemas/        # Zod schemas for data contracts
│   └── helpers/        # Test helpers (chrome mock)
├── backend/            # WebSocket relay for shared sessions
├── scripts/            # Release checking, verification gate, git hooks
├── skills/             # (if installed) Zo-side skill runtime
└── *.md                # README, AGENTS, QA_REPORT, PRIVACY, etc.
```

## Code style

- **No runtime dependencies beyond zod** — the extension loads nothing from npm
  at runtime; all browser APIs are vanilla.
- Chrome API calls use the callback pattern (MV3 service worker).
- Pure logic lives in `extension/lib/*.js` as ES modules (no `chrome.*`/DOM
  deps) so they're unit-testable directly.
- Config defaults live in `extension/lib/config.js`.
- Chrome mocks live in `tests/helpers/chrome-mock.ts`.

::: tip Editing this docs site?
The docs site has its own toolchain — `cd docs && npm install && npm run
docs:dev`. See [Testing & Verification → Documentation](../development/testing#documentation-site).
:::

## Next

- **[Testing & Verification](../development/testing)** — the test suite, Zod
  schemas, and the verify gate
- **[Building & Releasing](../development/building)** — packaging, CI/CD, and
  the release workflow
- **[Contributing](../contributing)** — the full PR process
