# Building & Releasing

The project has three pipelines: **CI** (verify every push/PR), **Release**
(cut a GitHub release from a `v*` tag), and **Docs** (build + deploy this
documentation site to GitHub Pages).

## Packaging

```bash
bun run package   # → zo-cobrowse.zip (zips extension/ minus .git/.DS_Store)
```

There is no compile/bundle step — the extension loads raw source files. `bun
build` is used only as a transpile *check* inside `verify` and CI, not to
produce shipped artifacts.

## CI — `.github/workflows/ci.yml`

Runs on every branch push + PR into `main`/`dev`, plus manual dispatch:

| Job | What it does |
|-----|--------------|
| `test` | `bun install` → `bun test` → transpile check (every `extension/*.js`) → validates the 5 contract schemas exist |
| `lint` | `bun run lint` → `scripts/check-release.sh` release-readiness checks |
| `package` | (needs test + lint) zips `extension/` → uploads `zo-cobrowse.zip` artifact |

## Release — `.github/workflows/release.yml`

Dormant until a `v*` tag is pushed (or triggered manually). On a tag:

1. `bun run verify` — full gate (tests + lint + transpile)
2. Builds the extension zip
3. Publishes a GitHub **Release** via `softprops/action-gh-release` with
   auto-generated notes, attaching `zo-cobrowse.zip`

### Cutting a release

Releases are deliberate, not automatic. From `main`:

```bash
git checkout main && git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag triggers `release.yml`; it re-verifies the tree, builds the zip, and
publishes the release. **Merging to `main` does not publish a release** — the
`v*` tag is the release trigger.

## Documentation site — `.github/workflows/docs.yml`

This docs site is built with **VitePress** (source in `docs/`) and deployed to
GitHub Pages at <https://ccagentorg.github.io/zo-cobrowse/>.

- **Trigger:** push to `main` with changes under `docs/**`, plus a manual
  `workflow_dispatch` button.
- **Build:** `setup-node` → `npm ci` (from `docs/package.json`) →
  `npm run docs:build` → `upload-pages-artifact` (from `docs/.vitepress/dist`).
- **Deploy:** `deploy-pages` into the `github-pages` environment with OIDC
  (`pages: write`, `id-token: write`).

The docs toolchain is **isolated** in `docs/package.json` — the extension's
root `package.json` (bun, zod) is untouched, preserving the zero-runtime-deps
invariant.

::: tip Enabling Pages
For the deploy step to work, the repo's **Settings → Pages** source must be set
to **GitHub Actions** (not "deploy from a branch"). The `docs.yml` workflow
handles the deploy once that's configured.
:::

## Versioning

Semantic Versioning as tracked in `CHANGELOG.md` (Keep a Changelog format).
The extension `manifest.json` version and the docs site version are kept in
sync on releases.
