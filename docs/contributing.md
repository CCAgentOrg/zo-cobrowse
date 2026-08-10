# Contributing

Thanks for contributing to Zo Co-browse! This project uses a git-flow-style
branching model with a hard verification gate. See
[Development Setup](development/setup) for the toolchain first.

## Branching model

```
main   (protected)  ← always the latest working release code; releases cut here
  ▲
  │  PR (CI must be green)
  │
dev    (protected)  ← integration branch; where features merge together
  ▲
  │  PR (CI must be green)
  │
feature/*  fix/*  chore/*   ← one branch per unit of work, branched from dev
```

**Rules:**

1. **Branch from `dev`, merge back to `dev`.** Every feature/fix/chore branch
   starts at `dev` and returns to `dev` via pull request. CI must be green to
   merge.
2. **`dev` → `main` is a PR.** Promotion to `main` stabilizes it for release.
   CI must be green; `main` is kept strictly up-to-date before merge.
3. **No direct pushes to `main` or `dev`.** Both are protected — all changes
   land via PR.
4. **Releases are deliberate, not automatic.** Cut releases from `main` with a
   `vX.Y.Z` tag (see [Building & Releasing](development/building)).
5. **Never commit secrets.** API tokens live in `chrome.storage.local` at
   runtime, not in the repo.

> Merging to `main` does **not** publish a release — it only keeps `main`
> releasable. The `v*` tag is the release trigger.

## Development setup

```bash
git clone https://github.com/CCAgentOrg/zo-cobrowse.git
cd zo-cobrowse
bun install          # installs zod + bun-types
bun run setup-hooks  # installs the pre-commit verification gate
bun test             # all 494 tests should pass
```

**Start every change from `dev`:**

```bash
git checkout dev && git pull
git checkout -b feature/<short-description>
```

## Development loop (verify before commit)

The repo practices **loop engineering**: every change is verified before it is
committed, and `bun run verify` runs all of it:

```bash
bun run verify   # = tests (bun test) → release checks (lint) → transpile check
```

- The pre-commit hook (from `setup-hooks`) runs `bun run verify` on every
  commit and **blocks** it if anything fails. No husky needed.
- Bypass deliberately with `git commit --no-verify`.
- CI runs the same checks on every branch push and on PRs into `main` and
  `dev`.

## Code style

- **No runtime dependencies beyond zod** — the extension loads nothing from
  npm at runtime.
- Chrome API calls use the callback pattern (MV3 service worker).
- New browser action types must be added to `tests/schemas/actions.ts`.
- Config defaults live in `extension/lib/config.js`.
- Chrome mocks live in `tests/helpers/chrome-mock.ts`.

## Pull request process

1. Run `bun run verify` — all tests plus release/transpile checks pass.
2. Update `CHANGELOG.md` (and `CHECKLIST.md`) if the change is user-visible.
3. Update the ticket completion table in `AGENTS.md` if implementing a tracked
   feature.
4. Open a PR against `dev` (not `main`) — CI runs the same `verify` gate.
   Promotion from `dev` → `main` is a separate, deliberate PR.

## Adding a new action type

1. Add the action kind to `ACTION_KINDS` in `tests/schemas/actions.ts`
2. Add the discriminator union member to `ActionSchema`
3. Implement the handler in `extension/background.js` `executeActions()`
4. Add tests in `tests/actions.test.ts`
5. Add the content-script handler in `extension/content.js` if needed

## Editing the docs site

The docs (this site) live in `docs/` and are built with VitePress:

```bash
cd docs && npm install
npm run docs:dev       # live preview
npm run docs:build     # verify it builds
```

Docs deploy automatically to GitHub Pages on merge to `main` with `docs/**`
changes. See [Building & Releasing → Documentation site](development/building#documentation-site).
