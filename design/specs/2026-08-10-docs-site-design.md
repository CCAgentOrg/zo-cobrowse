# Docs Site Design — Zo Co-browse

- **Date:** 2026-08-10
- **Status:** Approved (implementation in progress)
- **Branch:** `docs/vitepress-site`

## Purpose

Publish a comprehensive documentation site for the Zo Co-browse extension on
GitHub Pages, built and deployed automatically through CI/CD.

## Decisions (confirmed with user)

| Decision | Choice |
|----------|--------|
| Static site generator | **VitePress** (fits the JS/Bun toolchain) |
| Content scope | **Comprehensive** (~18 pages across guide/concepts/reference/development) |
| Source files | **Fresh docs/ Markdown** — root `.md` files (AGENTS.md, README, etc.) stay in place |
| Deploy trigger | **Push to main + manual `workflow_dispatch`** |
| Theme | **Default VitePress theme** (with a Zo-purple accent via VitePress theme primitives) |

## Architecture

- **Content root:** `docs/` — VitePress source tree (markdown pages + `.vitepress/`).
- **Build toolchain:** Node (not Bun) — VitePress runs on Node; a dedicated
  `docs/package.json` keeps the extension's zero-runtime-deps invariant intact.
- **Deploy:** Official Actions-based Pages deployment (`actions/configure-pages`
  → `upload-pages-artifact` → `deploy-pages`) with OIDC, in a new workflow
  `.github/workflows/docs.yml`, independent of `ci.yml` and `release.yml`.

## Page map (~18 pages)

```
docs/
├── .vitepress/config.ts      # base '/zo-cobrowse/', nav, sidebar, search
├── public/                   # logo, favicon
├── index.md                  # hero landing
├── guide/  getting-started · using-cobrowse · modes
├── concepts/ architecture · streaming · conversation
├── reference/ zo-api · actions · messages
├── development/ setup · testing · building
├── backend.md                # WebSocket relay quickstart
├── privacy.md                # from PRIVACY.md
├── contributing.md           # from CONTRIBUTING.md
└── changelog.md              # from CHANGELOG.md
```

## CI/CD workflow (`docs.yml`)

- **Triggers:** push to `main` with `paths: docs/**`, plus `workflow_dispatch`.
- **Permissions:** `contents: read`, `pages: write`, `id-token: write`.
- **Jobs:** `build` (setup-node, `npm ci`, `npm run docs:build`,
  `upload-pages-artifact`) → `deploy` (needs build, environment `github-pages`,
  `deploy-pages`).
- **Concurrency:** `group: pages` with `cancel-in-progress: false` (stable deploys).

Also added: `docs/.vitepress/dist` + `docs/.vitepress/cache` to `.gitignore`.

## Notable choices

- `base: '/zo-cobrowse/'` — repo is under `CCAgentOrg`, so the site lives at a
  project path, not an org root.
- Documentation is *reader-facing prose*, distilled from `extension/AGENTS.md`
  (Zo API reference), `README.md`, `PRIVACY.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, `BACKLOG.md`, and `backend/README.md`. Agent-facing indexing
  (AGENTS.md) is intentionally not copied into the site.
- VitePress is isolated in `docs/package.json` — the root `package.json`
  (bun, zod, tests) is untouched.

## Out of scope

Docs versioning, i18n, blog, analytics, custom Vue components.
