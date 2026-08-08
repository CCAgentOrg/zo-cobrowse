# Zo Co-browse — Backlog

> Source: QA round 2026-08-08 (see `QA_REPORT.md` for verified evidence) + ticket table in `AGENTS.md`.
> Severity legend: **P0** = broken/crash · **P1** = real functional defect · **P2** = robustness/dead code · **P3** = polish.

## Current state at a glance

- **Branch:** `Rewritet` (working tree clean, HEAD `8b39459`)
- **Tests:** ❌ red — `81 pass / 9 fail` (single structural bug in `tests/background.test.ts`). Docs claim 126–140 green; both stale.
- **Core chat → Zo** path works; message protocol is consistent; bang commands fully dispatched; permissions all exercised.
- **Main risk areas:** streaming port lifecycle (recurring "Done." bug class), context-menu config drift, options page gaps.

---

## 🔴 P0 — Do first (each is small + isolated)

| ID | Work item | File(s) | Effort |
|----|-----------|---------|--------|
| B-01 | Fix malformed `describe`/`beforeEach` nesting; restore green suite | `tests/background.test.ts:99-129` | XS |
| B-02 | Remove `pageContext` reference → fixes context-menu crash for page/selection/link/fill | `background.js:600` | XS |
| B-03 | Clone persona `<option>` into both selects → Lite Persona dropdown empty | `options.js:311-312` | XS |
| B-04 | Unify `enabledMenus` key (`editable`) across DEFAULTS, background, options → "fill field" menu hidden | `config.js`, `background.js:552`, `options.js` | S |
| B-05 | Escape + markdown-render `addSystemMessage`; stop `innerHTML +=` DOM thrash (XSS) | `sidepanel.js:1517` | S |

## 🟠 P1 — High-value defect fixes

| ID | Work item | File(s) | Effort |
|----|-----------|---------|--------|
| B-06 | Add `port.onDisconnect` handling; skip postMessage + skip retry when port dead | `background.js` onConnect | S |
| B-07 | Echo `sessionId` on every STREAM_* msg; guard STREAM_DONE in sidepanel | `background.js`, `sidepanel.js` | S |
| B-08 | Re-enable input/send on stream disconnect (panel stuck disabled) | `sidepanel.js:1712` | XS |
| B-09 | Delete dead first `sendQuery` definition (~120 LOC) | `sidepanel.js:901-1108` | S |
| B-10 | Snapshot `pendingActions` in action loop; break on Skip race | `sidepanel.js:1183` | XS |
| B-11 | Only retry transient stream errors; correct `STREAM_RECONNECT_DONE` order | `background.js:1-22` | S |
| B-12 | Add `enabledMenus` to startup `storage.sync.get` keys | `background.js:118` | XS |
| B-13 | Add `navigate`/`done` cases + `default:` to content `executeAction`/`onMessage` | `content.js:101-162` | XS |
| B-14 | Regenerate keyboard-shortcut table in options from manifest | `options.html:377` | XS |
| B-15 | Add "Reset to defaults" + onboarding reset; decide on `zoApiUrl` UI | `options.js`, `options.html` | M |

## 🟡 P2 — Robustness & cleanup

| ID | Work item | File(s) |
|----|-----------|---------|
| B-16 | Don't overwrite non-empty `fullText` with final `parsed.output` | `background.js:905` |
| B-17 | Look up full tab for `captureVisibleTab` when `tab.windowId` missing | `background.js:470` |
| B-18 | Validate `tabId` in NAVIGATE; remove dead `EXECUTE_CONTENT_SCRIPT` | `background.js:201-220` |
| B-19 | Normalize `testConnection` `ZO_OK` casing; trust `r.ok` | `background.js:1110` |
| B-20 | Derive model/persona list URLs from `config.zoApiUrl` | `background.js:1034,1049` |
| B-21 | Delete dead streaming state vars + wire thinking-indicator timeout | `sidepanel.js:10-12,113-117` |
| B-22 | Coerce `text` in `migrateOldFormat` / `saveCurrentConversation` | `sidepanel.js:536,598` |
| B-23 | Normalize STREAM_DONE body to `responseText`; prevent double-render | `sidepanel.js:1796-1842` |
| B-24 | Remove dead `STORAGE.CONVERSATIONS`; add `zoTtsVoice` to DEFAULTS+UI or drop it | `config.js`, `sidepanel.js` |
| B-25 | Remove unjustified `sandbox` CSP `'unsafe-eval'` | `manifest.json:94` |
| B-26 | Make `zoTtsRate` a `type=number` input | `options.js`, `options.html` |

## 🔵 P3 — Polish

- B-27 Route `addMessage('bot', …)` through markdown (use `'assistant'`) — `sidepanel.js:937,1958`
- B-28 Add CSS for action timeline + DuckDB tables (`.action-card`, `.db-table`, …) — `styles.css`
- B-29 Validate `personaMode` against `MODE_CYCLE`; fix `auto`/`Auto` initial paint — `sidepanel.js:399`
- B-30 Remove redundant `action.onClicked` open + dead `makeCaptureContextEval` — `background.js:157,323`
- B-31 De-tenant the default `zoSpaceEndpoint` — `config.js`, `background.js:39`
- B-32 Add `.catch` to all fire-and-forget `storage.session.set` — `background.js:813,823`
- B-33 Reference unused `icon32.png`/`icon256.png` or delete them; add privacy note for `debugger` banner — `manifest.json`

## 🚀 Feature backlog (from `AGENTS.md`, unchanged)

| Tier | Ticket | Status |
|------|--------|--------|
| Tier 1 | #16 Scheduled AI Commands | P0 — not started |
| Tier 1 | #17 Web Monitoring & Page Change Detection | P0 — not started |
| Tier 1 | #18 Shared Sessions (multi-participant) | P1 — `backend/relay.ts` exists, extension integration not done |
| Tier 1 | #19 Multi-Model Selection UI | P1 — not started |
| Tier 1 | #20 Tab Compare / Side-by-Side | P1 — depends on #10 |
| Tier 2 | #21 Page Context Export (PDF/MD) | P2 |
| Tier 2 | #14 Page Monitoring (basic) | P2 |
| Parity | #10 Multi-Tab Context | P3 |
| Parity | Image/file upload, Action templates, #23 Workflow Recording, Download files, Risk dialogs, #11 Web Store Listing | P3–P4 |

**Recommendation:** stabilize the P0/P1 stream-lifecycle + options items before opening new Tier-1 feature work — several (notably #18 and #19) will reuse the streaming port and persona-selector paths that currently have the P1 defects above.
