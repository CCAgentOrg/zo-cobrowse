# Zo Co-browse — Consolidated TODO

**Last updated**: 2026-07-13

Priority-stacked backlog. Work down from P0 to P2.

## Legend
| Signal | Meaning |
|--------|---------|
| ✅ Done | Implemented + tested |
| 🟢 Started | Code exists, tests may be partial |
| ⏳ Planned | Not yet started |
| 🟡 Blocked | Blocked by external dependency |

---

## P0 — Must Fix

| # | Ticket | Effort | Status | Notes |
|---|--------|--------|--------|-------|
| | Store assets (icons, screenshots, descriptions) | 2h | ⏳ Planned | Needed for Chrome Web Store submission |
| | Chrome Web Store publication | 4h | ⏳ Planned | Chrome review queue, privacy policy link |

## P1 — Core Features

| # | Ticket | Effort | Status | Notes |
|---|--------|--------|--------|-------|
| #01 | Screenshot & Vision | ⏳ Planned | background.js has capture + vision prompt; sidepanel needs UI wire-up | |
| #03 | Action Timeline | ✅ Done | Actions rendered in sidepanel (dom-actions container, timeline coloring) | |
| #04 | Run Skills from Panel | ✅ Done | Skill selector, RUN_SKILL message, handler in background, output in chat | |
| #07 | Command Templates (bangs) | ✅ Done | !bangs work in sidepanel, !help lists commands | |
| #08 | Create Automations | ✅ Done | CREATE_AUTOMATION handler, !auto command, sidepanel auto button | |
| #09 | Save Page to Workspace | ✅ Done | SAVE_PAGE handler, !save command, save path config | |
| #11 | Web Store | 2h | ⏳ Planned | Chrome review + distribution |
| #12 | Onboarding | 2h | ⏳ Planned | First-run tour, tooltip hints |
| #13 | Omnibox Commands | ✅ Done | manifest.json `omnibox`, background.js `onInputChanged`/`onInputEntered` | |
| #14 | Page Monitoring | 2h | ⏳ Planned | Periodic context re-capture, diff detection |
| #15 | Shared Sessions | 4h | ⏳ Planned | WebSocket relay (backend exists, needs extension wiring) |

## P2 — Polish & Testing

| # | Ticket | Effort | Status | Notes |
|---|--------|--------|--------|-------|
| #05 | DuckDB/SQLite Integration | ✅ Done | !query command, DUCKDB_QUERY handler, DuckDB CLI fallback | |
| #06 | Keyboard Shortcuts | ✅ Done | 4 shortcuts registered in manifest.json, commands listener in background | |
| — | Error handling tests | 1h | ✅ Done | `tests/error-handling.test.ts` — 8 tests |
| — | Action execution tests | 1h | ✅ Done | `tests/actions.test.ts` — 20 tests |
| — | Settings persistence tests | 1h | ✅ Done | `tests/settings-persistence.test.ts` — 16 tests |
| — | Screenshot/DuckDB/Automation coverage | 1h | ✅ Done | `tests/remaining-coverage.test.ts` — 6 tests |
| — | Privacy policy | 0.5h | ✅ Done | `PRIVACY.md` created |

---

## Release Checklist

- [ ] All 140 tests pass
- [ ] QA_REPORT.md reviewed
- [ ] PRIVACY.md added to repo root
- [ ] Package script (`bun run release`) verified
- [ ] CSP tightened (eval allowed only in sandbox)
- [ ] API routes authenticated
- [ ] Stream reconnection verified
- [ ] Git tag + GitHub release
- [ ] Chrome Web Store submission
