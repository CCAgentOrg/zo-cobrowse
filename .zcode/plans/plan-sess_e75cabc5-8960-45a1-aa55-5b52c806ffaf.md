## Plan: Loop engineering + CI/CD + maintenance (release deferred)

You deferred the version/tag/release. This plan does **everything else** — the verification loop, CI/CD backbone, and repo maintenance — and leaves version-bumping, CHANGELOG head, and tag/release for later once you share the issues you found.

Baseline (verified just now): 274 tests pass / 0 fail (19 files), lint green, all extension entries transpile via `bun build`, working tree clean.

### 1. Loop engineering — verify before commit (hard gate)

- **`scripts/verify.sh`** (new): runs **tests → release checks (lint) → per-file transpile check** (`bun build` of each extension entry). Prints a clear pass/fail summary, exits non-zero on any failure. Fast (<2s).
- **`package.json`**: add `"verify": "bash scripts/verify.sh"`.
- **`scripts/hooks/pre-commit`** (new, committed): runs `bun run verify`; blocks the commit on any failure (hard gate). Supports `--no-verify` override.
- **`scripts/install-hooks.sh`** (new): sets `git config core.hooksPath scripts/hooks` (no husky dependency — matches the repo's minimal-deps philosophy). Adds `"setup-hooks": "bash scripts/install-hooks.sh"`. I'll run it once so the hook is live in this clone.
- **`CONTRIBUTING.md`**: add a "Development Loop" section — *change → `bun run verify` → commit*; document hook install + `--no-verify` escape hatch.

### 2. CI/CD

- **`.github/workflows/ci.yml`** (rework, keeps the same badge URL):
  - Triggers: `push` to **all branches** (so `Rewritet` gets CI) + `pull_request` to `main` + manual `workflow_dispatch`.
  - `test` job: install → `bun test` → `bun build` transpile-check every extension entry (replaces the weaker `node --check` loop) → schema-exists checks (cleaned up).
  - `lint` job: `bun run lint`.
  - `package` job: needs test+lint → zip via the existing `dist/` approach → upload artifact. **Remove** the `softprops/action-gh-release` step from CI (moves to CD).
- **`.github/workflows/release.yml`** (new, **dormant** — won't fire until a `v*` tag exists, so no release now): trigger on `push: tags: v*` + `workflow_dispatch`. Re-verifies (test+lint+build), packages the zip, publishes a GitHub Release with auto-generated notes + zip artifact. Ready for when you cut the release.

### 3. Repo maintenance

- **`.gitignore`**: remove `bun.lock` (it's tracked — ignoring it hides lockfile changes from CI); add `zo-cobrowse.zip` (stray `bun run package` output).
- **`CHANGELOG.md`** (new, Keep-a-Changelog format): an **"Unreleased"** section capturing the last ~18 commits (streaming hardening, thinking bubble, zo.computer-style UI, P0–P3 audit fixes, sticky layout). Versioned head left blank for the deferred release.
- **Stale doc counts fixed** (README.md, CONTRIBUTING.md, CHECKLIST.md, AGENTS.md): "140 tests / 13 files" → **274 tests / 19 files**; update AGENTS.md feature-status line (210 → 274).
- **`AGENTS.md`**: document the new `verify` script + pre-commit hook in "Tests & scripts".
- **`BACKLOG.md`**: update "Current state" (274 pass, CI on all branches, loop hooks active, release/TAG pending your issues).
- **`QA_REPORT.md`**: add a short infrastructure-round note (dates, new checks).
- **Version files left untouched** (manifest 0.0.1, package 0.1.0) — that's release work, deferred per your call.

### Not doing
- No version bump, no git tag, no `softprops` Release trigger, no push/merge to `main` (your merge + release come after we address the issues you found).
- No husky/lint-staged (plain committed hooks keep zero extra runtime deps).

### Verification loop (after each change, before I commit)
`bun run verify` (tests + lint + transpile) on every edit; the pre-commit hook enforces it; I'll commit atomically and show you each step.

### Files touched
`.github/workflows/ci.yml` · `.github/workflows/release.yml` (new) · `scripts/verify.sh` (new) · `scripts/hooks/pre-commit` (new) · `scripts/install-hooks.sh` (new) · `package.json` · `.gitignore` · `CHANGELOG.md` (new) · `README.md` · `CONTRIBUTING.md` · `CHECKLIST.md` · `AGENTS.md` · `BACKLOG.md` · `QA_REPORT.md`