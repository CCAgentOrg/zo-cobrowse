# Testing & Verification

Zod schemas are the **single source of truth** for data contracts, and the
test suite is the verification backstop. This page covers how the project
guards against regressions.

## The test suite

**494 tests across 23 files, 0 failures (1240 `expect()` calls).** Every
extension JS file transpiles cleanly via `bun build`.

```bash
bun test            # run the suite
bun test --watch    # watch mode
bun run verify      # full gate: tests → release checks → transpile check
```

## Verification layer (Zod schemas)

Contracts are defined as **Zod schemas** in `tests/schemas/` and used by the
tests as the single source of truth. Prefer schema validation over scattered
`.toContain()` string checks.

| Schema file | Validates | Used by |
|-------------|-----------|---------|
| `tests/schemas/manifest.ts` | full `manifest.json` (MV3 shape, commands, omnibox, icons, permissions) | `tests/manifest.test.ts` |
| `tests/schemas/actions.ts` | the Zo action protocol (`navigate`/`click`/`fill`/`extract`/`scroll`/`wait`/`done`) | `tests/message-contract.test.ts` |
| `tests/schemas/messages.ts` | every message type passed sidepanel ↔ background ↔ content | `tests/message-contract.test.ts` |
| `tests/schemas/config.ts` | the `DEFAULTS` config object | (config tests) |
| `tests/schemas/bang-commands.ts` | `parseBangCommand()` output (discriminated union on `kind`) | `tests/bang-commands.test.ts` |
| `tests/schemas/modes.ts` | the Mode system (`BUILTIN_MODES`, `resolveMode`) | `tests/modes.test.ts` |

## Contract tests

**Two contract tests guard the message boundaries:**

- `tests/message-contract.test.ts` asserts background.js has a `case` for
  **every** message type in the schema, **AND** that the schema isn't missing a
  handler background.js already implements.

> **Add a new message type → add it to `tests/schemas/messages.ts`, or this
> test fails.**

## Pattern for pure logic

Extract logic into `extension/lib/<name>.js` as an ES module (no `chrome.*`/
DOM deps), import it from the consuming extension script (loaded as
`type="module"`), and unit-test it by importing directly + validating its
output against its Zod schema. Reference: `extension/lib/bang-commands.js` ↔
`tests/bang-commands.test.ts`.

## Key test files

| File | Covers |
|------|--------|
| `tests/background.test.ts` | Config, messaging, omnibox, generate mode |
| `tests/content.test.ts` | Context capture, action execution |
| `tests/sidepanel.test.ts` | History, init, new-chat, modes, onboarding (~35 KB) |
| `tests/options.test.ts` | Settings form, reset-to-defaults |
| `tests/modes.test.ts` | `BUILTIN_MODES`, custom modes, `normalizeActions` |
| `tests/intent.test.ts` | `detectIntent()` read-vs-action classification |
| `tests/bang-commands.test.ts` | `!` command parser |
| `tests/sse-parsing.test.ts` | Streaming SSE event parsing (~22 KB) |
| `tests/message-contract.test.ts` | Boundary completeness |
| `tests/manifest.test.ts` | Manifest validation against schema |
| `tests/relay.test.ts` | WebSocket backend endpoints |
| `tests/css-layout.test.ts` | Sticky layout / DOM structure |
| `tests/strict-module.test.ts` | Pure modules are import-safe |

Plus: `action-timeline`, `actions`, `config-behavior`, `error-handling`,
`form-fill`, `html`, `normalize-actions`, `remaining-coverage`,
`settings-persistence`.

## The verify gate (`bun run verify`)

`scripts/verify.sh` — runs in three stages:

1. **Tests** — `bun test`
2. **Release checks** — `bun run lint` → `scripts/check-release.sh`
3. **Transpile check** — loops `bun build <file>` over every `extension/*.js`
   entry point to confirm each transpiles cleanly

It runs locally (pre-commit hook), and CI mirrors it on every push and PR.

## Adding a feature

1. **Extend the relevant schema first** (`tests/schemas/…`), then write the
   code + a test that validates the code's output against the schema.
2. This catches structural regressions that `.toContain()` misses.

## Documentation site

The docs site (this site) has its own isolated toolchain:

```bash
cd docs
npm install
npm run docs:dev       # live dev server at http://localhost:5173
npm run docs:build     # production build → docs/.vitepress/dist
npm run docs:preview   # serve the built site locally
```

Docs changes are **not** part of the extension's `verify` gate (the docs are
Node/VitePress, the extension is Bun). Docs are deployed to GitHub Pages by the
`docs.yml` workflow on push to `main` — see [Building & Releasing →
Documentation site](../development/building#documentation-site).
