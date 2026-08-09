# Contributing to Zo Co-browse

## Development Setup

1. Clone the repo
2. Run `bun install` (installs zod + bun-types)
3. Run `bun run setup-hooks` (installs the pre-commit verification gate)
4. Run `bun test` — all 274 tests should pass
5. Load `extension/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked)

## Development Loop (verify before commit)

This repo is set up for **loop engineering**: every change is verified before it
is committed, and `bun run verify` is the single gate that runs all of it:

```bash
bun run verify   # = tests (bun test) → release checks (lint) → transpile check
```

- `bun run setup-hooks` (one-time) points `core.hooksPath` at `scripts/hooks/`,
  so a committed **pre-commit hook** runs `bun run verify` on every `git commit`
  and **blocks the commit** if anything fails. No husky needed.
- The hook is a hard gate — bypass it deliberately with `git commit --no-verify`.
- CI runs the same checks on every branch push and PR to `main`
  (`.github/workflows/ci.yml`), so verification also runs remotely.
- The gate itself is just `scripts/verify.sh`: keep new checks there if you add
  any (e.g. a new transpile target), and they run in both the hook and CI.

## Project Structure

```
zo-cobrowse/
├── extension/          # Chrome extension (service worker, side panel, options)
│   ├── lib/            # Shared modules (config, bang-commands)
│   ├── icons/          # Extension icons (16, 48, 128)
│   ├── sidepanel.html  # Co-browse side panel UI
│   ├── background.js   # Service worker (Zo API calls, action execution)
│   ├── content.js      # Content script (DOM capture, action dispatch)
│   ├── options.html    # Options page (API URL, model, persona)
│   └── manifest.json   # Chrome extension manifest (V3)
├── tests/              # Bun test suite (274 tests across 19 files)
│   ├── schemas/        # Zod schemas for data contracts
│   └── helpers/        # Test helpers (chrome mock)
├── backend/            # WebSocket relay for shared sessions
├── brainstorming/      # Design docs, roadmap, feature comparisons
├── scripts/            # Release checking, verification gate, git hooks
├── AGENTS.md           # Project index & state tracking
├── PRIVACY.md          # Privacy policy (for Chrome Web Store)
├── CHECKLIST.md        # Human verification checklist
└── QA_REPORT.md        # QA report & known issues
```

## Running Tests

```bash
bun run verify        # Full gate: tests + release checks + transpile check
bun run test:watch    # Watch mode (auto-rerun on changes)
```

## Code Style

- **No runtime dependencies beyond zod** — the extension loads nothing from npm at runtime
- Chrome API calls use callback pattern (MV3 service worker)
- New browser action types must be added to `tests/schemas/actions.ts` Zod schema
- Config defaults live in `extension/lib/config.js`
- Chrome mocks live in `tests/helpers/chrome-mock.ts`

## Pull Request Process

1. Run `bun run verify` — all 274 tests plus release/transpile checks pass
2. Update `CHANGELOG.md` (and `CHECKLIST.md`) if the change is user-visible
3. Update the ticket completion table in `AGENTS.md` if implementing a tracked feature
4. Open a PR against `main` (CI runs the same `verify` gate)

## Adding a New Action Type

1. Add the action kind to `ACTION_KINDS` in `tests/schemas/actions.ts`
2. Add the discriminator union member to `ActionSchema`
3. Implement the handler in `extension/background.js` `executeActions()`
4. Add tests in `tests/actions.test.ts`
5. Add content script handler in `extension/content.js` if needed
