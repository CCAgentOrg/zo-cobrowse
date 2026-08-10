# Roadmap

Updated 2026-08-09. All QA-report findings from the 2026-08-08 round are
**resolved** — remaining items are feature work. The authoritative,
living status lives in `BACKLOG.md` at the repo root.

## Current state

- **Branches:** `Rewritet` merged → `main` (fast-forward, 22 commits)
- **Tests:** ✅ **494 pass / 0 fail** (23 files, 1240 `expect()` calls)
- **Loop engineering:** `bun run verify` gate + committed hard-gate pre-commit
  hook (`bun run setup-hooks` to install)
- **CI/CD:** CI runs on every branch push + PR to `main` (tests + transpile +
  release checks + zip artifact); `release.yml` is dormant until a `v*` tag is
  pushed; `docs.yml` deploys this docs site to GitHub Pages
- **Streaming:** hardened end-to-end (sessionId isolation, port-disconnect
  safety, retry correctness, 60s liveness timeout)
- **P0/P1/P2/P3 QA findings:** all closed (P2-31 deferred by design — see below)
- **Release:** version + tag **pending** — flagged as more issues to address
  before tagging

## Deferred by design

- **B-31** — Default `zoSpaceEndpoint` is tenant-specific
  (`cashlessconsumer.zo.space`). Left as-is because it's the documented,
  working integration host; users can override via the `#space-endpoint` field.

## Feature backlog

| Tier | Ticket | Status | Notes |
|------|--------|--------|-------|
| Tier 1 | #16 Scheduled AI Commands | P0 — not started | Reuses streaming + persona paths (now stable) |
| Tier 1 | #17 Web Monitoring & Page Change Detection | P0 — not started | Zo automations + DuckDB history |
| Tier 1 | #18 Shared Sessions (multi-participant) | P1 — `backend/relay.ts` exists, extension integration not done |
| Tier 1 | #19 Multi-Model Selection UI | P1 — not started | Model picker in the panel |
| Tier 1 | #20 Tab Compare / Side-by-Side | P1 — depends on #10 |
| Tier 2 | #21 Page Context Export (PDF/MD) | P2 | |
| Tier 2 | #14 Page Monitoring (basic) | P2 | |
| Parity | #10 Multi-Tab Context | P3 | |
| Parity | Image/file upload, #23 Workflow Recording, Download files, Risk dialogs, #11 Web Store Listing | P3–P4 | |

## Shipped tickets

Screenshot/vision, right-click context menu, streaming action timeline, skill
runner, NL→DuckDB, keyboard shortcuts, command templates, automations,
save-page, onboarding, omnibox.
