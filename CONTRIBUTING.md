# Contributing to Zo Co-browse

## Development Setup

1. Clone the repo
2. Run `bun install` (installs zod + bun-types)
3. Run `bun test` — all 140 tests should pass
4. Load `extension/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked)

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
├── tests/              # Bun test suite (140 tests across 13 files)
│   ├── schemas/        # Zod schemas for data contracts
│   └── helpers/        # Test helpers (chrome mock)
├── backend/            # WebSocket relay for shared sessions
├── brainstorming/      # Design docs, roadmap, feature comparisons
├── scripts/            # Release checking scripts
├── AGENTS.md           # Project index & state tracking
├── PRIVACY.md          # Privacy policy (for Chrome Web Store)
├── CHECKLIST.md        # Human verification checklist
└── QA_REPORT.md        # QA report & known issues
```

## Running Tests

```bash
bun test              # Run all tests
bun run test:watch    # Watch mode (auto-rerun on changes)
```

## Code Style

- **No runtime dependencies beyond zod** — the extension loads nothing from npm at runtime
- Chrome API calls use callback pattern (MV3 service worker)
- New browser action types must be added to `tests/schemas/actions.ts` Zod schema
- Config defaults live in `extension/lib/config.js`
- Chrome mocks live in `tests/helpers/chrome-mock.ts`

## Pull Request Process

1. Run `bun test` — all 140 must pass
2. Run `bun run check-icons` to verify release readiness
3. Update the ticket completion table in `AGENTS.md` if implementing a tracked feature
4. Open a PR against `main`

## Adding a New Action Type

1. Add the action kind to `ACTION_KINDS` in `tests/schemas/actions.ts`
2. Add the discriminator union member to `ActionSchema`
3. Implement the handler in `extension/background.js` `executeActions()`
4. Add tests in `tests/actions.test.ts`
5. Add content script handler in `extension/content.js` if needed
