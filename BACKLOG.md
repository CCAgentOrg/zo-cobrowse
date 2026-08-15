# Zo Co-browse — Backlog

> Updated 2026-08-10. All QA-report findings from the 2026-08-08 round are **resolved**
> (see `QA_REPORT.md` remediation log). Remaining items are feature work.
> An **infrastructure round** (2026-08-09) added the loop-engineering gate, CI on
> all branches, and a dormant release workflow — see below.

## Current state

- **Branches:** `Rewritet` merged → `main` (fast-forward, 22 commits); working tree clean
- **Tests:** ✅ **534 pass / 0 fail** (24 files, 1381 expect() calls)
- **Loop engineering:** `bun run verify` gate + committed hard-gate pre-commit hook (`bun run setup-hooks` to install)
- **CI/CD:** CI runs on every branch push + PR to `main` (tests + transpile + release checks + zip artifact); `.github/workflows/release.yml` publishes `v*` tag releases (used for v0.0.2)
- **Streaming:** hardened end-to-end (sessionId isolation, port-disconnect safety, retry correctness, 60s liveness timeout)
- **P0/P1/P2/P3 QA findings:** all closed (P2-31 deferred by design — see below)
- **Release:** ✅ **v0.0.2** tagged + GitHub release published (2026-08-10) with the extension zip. Next milestone: Chrome Web Store submission (#11)

## ✅ Completed this round

| IDs | Summary |
|-----|---------|
| B-01 | Fix malformed `background.test.ts` → green suite |
| B-02..05 | P0: context-menu crash, persona dropdown, enabledMenus key, addSystemMessage XSS |
| B-06..08, B-11 | Streaming port disconnect + retry lifecycle (safePost, onDisconnect, input re-enable) |
| B-07 | sessionId echo on all STREAM_* messages |
| B-09 | Delete dead duplicate `sendQuery` (~120 LOC) |
| B-10 | Snapshot `pendingActions` against Skip race |
| B-12..13 | enabledMenus startup load + content.js navigate/done/default |
| B-14..15 | Correct shortcut docs + Reset-to-defaults |
| B-16..20 | Background robustness (fullText guard, captureVisibleTab tab, NAVIGATE validation, testConnection casing, apiOrigin) |
| B-21..26 | Sidepanel robustness (dead vars, thinking timeout, text coercion, STREAM_DONE normalize, config cleanup, sandbox CSP removal, tts-rate input) |
| B-27..30, B-32 | P3 polish (bot→assistant, badge normalize, dead code removal, session.catch) |
| B-28 | Action timeline + DuckDB CSS |

## Deferred (by design)

- **B-31** — Default `zoSpaceEndpoint` is tenant-specific (`cashlessconsumer.zo.space`). Left as-is because it's the documented working integration host (AGENTS.md references it as the landing page) and changing it would break the active setup. Users can override via the `#space-endpoint` field.

## 🚀 Feature backlog (from `AGENTS.md`)

| Tier | Ticket | Status | Notes |
|------|--------|--------|-------|
| Tier 1 | #16 Scheduled AI Commands | P0 — not started | Reuses streaming + persona paths (now stable) |
| Tier 1 | #17 Web Monitoring & Page Change Detection | P0 — not started | Zo automations + DuckDB history |
| Tier 1 | #18 Shared Sessions (multi-participant) | P1 — `backend/relay.ts` exists, extension integration not done |
| Tier 1 | #19 Multi-Model Selection UI | P1 — not started | model picker in panel |
| Tier 1 | #20 Tab Compare / Side-by-Side | P1 — depends on #10 |
| Tier 2 | #21 Page Context Export (PDF/MD) | P2 | |
| Tier 2 | #14 Page Monitoring (basic) | P2 | |
| Parity | #10 Multi-Tab Context | P3 — context half DONE (`feature/tab-contexts`): tab references (manifest + excerpt + `read_tab` on-demand, chip strip + `@` mention); cross-tab actions + tab management remain | Spec: docs/superpowers/specs/2026-08-14-tab-contexts-design.md |
| Parity | Image/file upload, #23 Workflow Recording, Download files, Risk dialogs, #11 Web Store Listing | P3–P4 | |
