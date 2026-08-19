# Testing & Verification

Zod schemas are the **single source of truth** for data contracts, and the
test suite is the verification backstop. This page covers how the project
guards against regressions.

## The test suite

**767 tests across 33 files, 0 failures (1978 `expect()` calls).** Every
extension JS file transpiles cleanly via `bun build`.

```bash
bun test tests/     # run the unit + integration suite
bun run test:watch  # watch mode
bun run verify      # full gate: tests → release checks → transpile check
bun run test:e2e    # real-Chromium E2E (separate Playwright suite — see below)
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

1. **Tests** — `bun test tests/`
2. **Release checks** — `bun run lint` → `scripts/check-release.sh`
3. **Transpile check** — loops `bun build <file>` over every `extension/*.js`
   entry point to confirm each transpiles cleanly

It runs locally (pre-commit hook), and CI mirrors it on every push and PR.

CI also collects **coverage**: the `test` job runs with Bun's built-in
`--coverage` (text summary in the job log + `coverage/lcov.info` uploaded as
the `coverage-lcov` artifact). The same summary is available locally with
`bun run test:coverage`. Two caveats when reading the numbers:

- Only what the bun suite executes counts — the Playwright e2e layer runs in
  a separate Chromium process and does **not** feed these counters, so paths
  covered only by real-browser tests (omnibox, panel shell, live extension
  APIs) show as uncovered.
- `extension/lib/*` is directly imported (96–100%); the chrome-coupled entry
  files are exercised through the integration harness, so their percentages
  reflect the in-process paths only.

## Adding a feature

1. **Extend the relevant schema first** (`tests/schemas/…`), then write the
   code + a test that validates the code's output against the schema.
2. This catches structural regressions that `.toContain()` misses.

## Integration tests (`tests/integration/`)

Above the unit layer, the integration tests load the REAL extension scripts —
`background.js` as a module, `content.js` executed against a happy-dom page,
`sidepanel.js` against the real `sidepanel.html` — and wire them together on
a shared fake-chrome **message bus** (`tests/helpers/chrome-mock.ts`):
`runtime.sendMessage` actually dispatches, `runtime.connect()` returns live
port pairs, storage areas keep real stores and broadcast `onChanged`, and
`tabs.sendMessage` routes to a mounted content-script target. The Zo API is
a recording fetch mock (`tests/helpers/zo-fetch-mock.ts`) that streams the
committed SSE fixtures through the real reader loop — including *gated*
streams (`deferredSse`) the test releases chunk-by-chunk for deterministic
mid-stream UI assertions.

This closes the long-standing gap (ticket-25 audit): "No E2E tests for the
sidepanel↔background message flow." Key harness constraints to know before
adding tests there:

- **bun runs all test files in one process with a shared module registry** —
  every file that imports `background.js`/`sidepanel.js` must use a unique
  cache-busting query string (`?file=<name>`), and **only ONE sidepanel
  instance may exist per process** (it reads `document` at call time).
- That's why all panel scenarios live in `tests/integration/extension-flow.test.ts`
  — driven through the real background, so what's asserted is the actual
  wire protocol.

## Browser E2E (`e2e/`, Playwright)

A second suite runs the extension in a **real Chromium** (Playwright
persistent context + `--load-extension`, MV3-compatible new headless):

```bash
bun run test:e2e         # headless
bun run test:e2e:headed  # watch it drive
```

Layout: `e2e/mock-zo/server.mjs` is a local mock Zo API + static fixture
site (SSE over real HTTP, scenarios routed by keywords in the request's
`## User Request`); `e2e/helpers/extension.ts` launches the extension, seeds
config through the real service worker, and opens `sidepanel.html` as a tab
(the side-panel shell isn't drivable over CDP — a documented workaround; the
harness keeps the website tab active so captures target it). The 6 spec files
cover onboarding, streaming (progressive text, thinking trace, error card +
retry), the action loop (real DOM mutation on the fixture site), capture +
context policy, the options page (Test Connection, prompts editor), and
persistence across panel reload.

E2E runs as its own `e2e` CI job (not in the pre-commit gate — too slow for
every commit) and needs `bunx playwright install chromium` once locally.

**Known limits (stay manual):** the omnibox, `chrome.commands` hotkeys, the
true side-panel shell lifecycle, MV3 service-worker suspension, and anything
against the live Zo API.

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
