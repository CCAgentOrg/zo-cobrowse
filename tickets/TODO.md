# Zo Co-browse — Consolidated TODO

**Last updated**: 2026-08-10

Priorities ranked by **Zo affinity** — how uniquely each feature leverages Zo Computer's platform (automations, skills, datasets, multi-model BYOK, DuckDB, workspace). Build the moat first, catch up on parity later.

---

## Legend

| Tier | Zo Affinity | Signal | Meaning |
|------|-------------|--------|---------|
| P0 | 8–10/10 | 🟢 Unique Zo moat | Only ZoCoBrowse can do this |
| P1 | 6–7/10 | 🟡 Strong leverage | Meaningful Zo integration advantage |
| P2 | 3–5/10 | 🔴 Parity catch-up | Needed for completeness, competitors do it |
| P3 | 1–2/10 | ⚫ Distribution | Chrome Web Store, not a feature |

---

## 🟢 P0 — Unique Zo Moat (build first)

| # | Ticket | Zo Affinity | Effort | Status | Why |
|---|--------|-------------|--------|--------|-----|
| #16 | **Scheduled AI Commands** | 10/10 | 3h | ⏳ Planned | Zo already has 48 automations. Add panel UI to create/manage them from the browser. No competitor can pipe browser context through Zo's full toolchain. |
| #17 | **Web Monitoring & Page Change** | 10/10 | 4h | ⏳ Planned | Zo automations as backend + DuckDB diff history + workspace archival. Competitors monitor pages; Zo triggers skills/saves data on change. |
| #18 | **Shared Sessions (multi-participant)** | 9/10 | 4h | ⏳ Planned | `backend/relay.ts` + WebSocket exists. Multi-user co-browsing is ZoCoBrowse's unique architectural moat. Zero competitors offer this. |
| #19 | **Multi-Model Selection UI** | 9/10 | 2h | ⏳ Planned | Zo BYOK supports any provider. A model picker in panel: "Use Claude for reasoning, Gemini for vision, Zo model for code." Unlocks Zo flexibility from browser. |
| #20 | **Tab Compare / Side-by-Side** | 8/10 | 3h | ⏳ Planned | Multi-tab capture → Zo cross-references across datasets, runs skills on merged contexts. HARPA compares URLs; Zo cross-references intelligently. |

## 🟡 P1 — Strong Zo Leverage (next)

| # | Ticket | Zo Affinity | Effort | Status | Why |
|---|--------|-------------|--------|--------|-----|
| #21 | **Page Export (PDF/MD)** | 7/10 | 2h | ⏳ Planned | Zo has `book-typesetting` skill (pandoc+Eisvogel) and Hugo pipeline. Export → Zo formats and publishes to newsletter. |
| #14 | **Page Monitoring (basic)** | 6/10 | 2h | ⏳ Planned | Periodic re-capture. Pair with #17 for full power. |
| — | **Upload file/image to panel** | 5/10 | 2h | ⏳ Planned | Upload → Zo reads (DuckDB, images, docs) and runs skills. |
| — | **Action Templates Library** | 4/10 | 3h | ⏳ Planned | Pre-built prompts from Zo's 89 skills (adaptive). HARPA has 100+ templates; we can generate dynamic ones from Zo's registry. |
| — | **Download files from Zo** | 3/10 | 1h | ⏳ Planned | Zo writes to workspace → download via extension. Integrator feature. |

## 🔴 P2 — Parity Catch-up (later, but needed for Web Store)

| # | Ticket | Zo Affinity | Effort | Status | Why |
|---|--------|-------------|--------|--------|-----|
| #23 | **Workflow Recording** | 4/10 | 4h | ⏳ Planned | Record/replay clicks. Competitors better. Future: save as Zo skills. |
| — | **Risk confirmation dialogs** | 2/10 | 1h | ⏳ Planned | "Allow Zo to click on this page?" — every extension has this. |
| — | **Site-Level Permissions** | 2/10 | 2h | ⏳ Planned | Per-domain allow/block list. Config UI work. |
| — | **Console & Network Logs** | 2/10 | 3h | ⏳ Planned | Devtools panel integration for debug. Low ROI vs P0. |
| #11 | **Store assets** | 1/10 | 2h | ⏳ Planned | Icons, descriptions, screenshots |

## ✅ Already Done

| # | Ticket | Zo Affinity | Key files |
|---|--------|-------------|-----------|
| #04 | Run Skills from Panel | 9/10 | Skill selector + `RUN_SKILL` handler |
| #05 | NL → DuckDB Queries | 8/10 | `!query`, `DUCKDB_QUERY` handler |
| #08 | Create Automations from Panel | 8/10 | `CREATE_AUTOMATION` handler, `!auto` |
| #09 | Save Page to Workspace | 8/10 | `SAVE_PAGE` handler, `!save` |
| #03 | Streaming Action Timeline | 6/10 | Action timeline + reconnection banner |
| #01 | Screenshot & Vision | 7/10 | captureVisibleTab + JPEG+quality |
| #02 | Right-Click Context Menu | 6/10 | contextMenus registered |
| #06 | Keyboard Shortcuts | 5/10 | 4 shortcuts + onCommand |
| #07 | Quick Command Templates | 5/10 | Presets UI + !bang commands |
| #12 | Onboarding Flow | 4/10 | Overlay tour + state machine |
| #13 | Omnibox Commands | 5/10 | Omnibox + onInputEntered |
| — | Error handling tests | — | `tests/error-handling.test.ts` — 8 tests |
| — | Action execution tests | — | `tests/actions.test.ts` — 20 tests |
| — | Settings persistence tests | — | `tests/settings-persistence.test.ts` — 16 tests |
| — | Coverage tests | — | `tests/remaining-coverage.test.ts` — 6 tests |
| — | Privacy policy | — | `PRIVACY.md` |
| — | 534 tests passing | — | All tests pass |

---

## Release Checklist

- [x] Git tag + GitHub release (v0.0.2, 2026-08-10)
- [ ] Chrome Web Store submission (after P0 items done)
