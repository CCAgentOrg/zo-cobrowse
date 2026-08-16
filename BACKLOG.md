# Zo Co-browse — Backlog

> Updated 2026-08-15. All QA-report findings from the 2026-08-08 round are **resolved**
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
| Parity | Chat tabs + chat management (no ticket) | DONE 2026-08-15 (`feature/tab-interface`): chat tab bar (≤8 open, per-chat Zo threads + context state, streams survive switches, parked `pendingActions`), history-view rename + search | Spec: docs/superpowers/specs/2026-08-15-chat-tabs-design.md; follow-ups (pin/export, multi-window sync) open |
| Parity | Image/file upload, #23 Workflow Recording, Download files, Risk dialogs, #11 Web Store Listing | P3–P4 | |

## 🧪 Proposed 2026-08-15 — brainstormed, pending triage

> Design-exploration outcomes (approach already chosen, not yet spec'd or built).
> Suggested build order: **#24 → #25 → #26** — #25's verification spike is tiny/independent and can go first or parallel; #26's quality layer depends on #24's `get_form`.
> API facts verified against the live OpenAPI spec (2026-08-15): `/zo/ask` accepts **string `input` only** — no attachment, image, or content-block fields, and there are **no MCP/tools/integrations endpoints**. `/models/catalog` (no-auth, cached) exposes `supports_images` per model.
> #28 appended 2026-08-16 (intake request) — independent of #24–#26 except the optional `read_file` pull, which would reuse #24's loop.

| ID | Feature | Chosen approach | Notes |
|----|---------|-----------------|-------|
| #24 | Context-on-demand (pull protocol) | Generalize the existing `read_tab` in-stream loop into a general pull mechanism: new actions `read_page` / `get_dom` / `get_form`; prompts carry manifest + excerpts only, Zo fetches heavy context on demand inside the same stream (reuses `finishStreamWithTabLoop` pattern, loop budget + send-once per page-hash). Solves token cost + answer quality (fetched data is complete/targeted, not budget-sliced). | True **MCP server** (relay-hosted browser tools, Zo as MCP client) kept as a research spike only — no Zo-side MCP support in the public API. If Zo adds it, pull actions translate 1:1 into MCP tools. Cost: each pull = one extra LLM round-trip. |
| #25 | Vision-gated screenshots | **Verify-then-gate.** (1) Live probe: does the tier-3 data-URL markdown image (`![page](data:image/jpeg;base64,…)` inside `input`) actually reach a vision model? Synthetic image + "what color?" against a text-only control — never tested to date. (2) If yes: gate screenshot capture on `/models/catalog` `supports_images`; skip capture for non-vision models (token savings) + suggest a vision model when visual mode is picked without one. | If the probe fails, this becomes transport-discovery work — tier 3 is dead until Zo adds image support to the API. |
| #26 | Form filling: batch + robust + confirm | Three layers: (1) `get_form` pull action → complete form schema (all fields, types, options, required, label associations) — the robustness fix for budget-sliced 30-field capture; (2) batch `fill_form` action — selector→value map applied atomically, field targeting via label text / `aria-labelledby` / placeholder proximity (not bare CSS selectors), rendered as ONE action-timeline card with per-field results; (3) confirm-before-fill for sensitive forms (heuristic: password/card/CVV fields or login/checkout URLs) — Zo proposes the value map, sidepanel shows an editable review table, one Confirm executes. | **Saved profiles/identities explicitly out of scope** (owner decision 2026-08-15). Depends on #24 for `get_form`; batch fill + confirm UX could ship independently if triaged first. |
| #27 | Cold-start research → "open all" tabs | Two halves: (1) **cold start** — asking Zo works when the user has nothing open (new/blank tab): skip page-context attach entirely instead of sending capture-error/newtab noise; verify all three capture paths' failure behavior on `chrome://newtab`. (2) **research results → tabs** — parse URLs from any assistant answer (markdown links, mode-agnostic) → link-chips card with **Open all (N)** one-click → `chrome.tabs.create` ×N (confirm above a small cap, ~5). Optional later: structured `open_urls` action in the JSON envelope instead of parsing. | Research mode already exists (read-only, Zo web search needs no page context) — this is UI/flow work, not API work. Synergy: opened tabs become referenceable via existing tab-context chips → `read_tab` follow-ups. Open questions for triage: auto-add opened tabs as references? exact cap? background vs foreground tabs? Independent of #24–#26 — can ship anytime. |
| #28 | Composer reference pickers: `/` skills + `%` Zo files | Mimic Zo's UI reference affordances in the extension composer, reusing the `@` tab-autocomplete machinery (trigger regex → popup → chip → per-send payload, `sidepanel.js` ~2029–2090) as the template. **`/` skills picker:** enumerate the user's Zo skills into a filterable popup; selecting one attaches a visible skill chip to the turn and sends the natural-language invocation (`Run the skill "<name>"…`) — same wire format as today's `runSkill`/`!skill`, superseding typed `!skills`/`!skill` and waking the dormant `RUN_SKILL` handler. **`%` files picker:** browse the Zo workspace (expandable folders); selected paths ride as a new `## Referenced Files` manifest section in `buildPrompt` (new `SECTION_ID` beside `## Referenced Tabs`, shown in the prompt inspector) — Zo resolves content server-side via its own file toolchain, so only paths/metadata cross the wire; optional `read_file {path}` pull action mirrors `read_tab` (reuses #24's generalized pull loop). | **API constraint (verified vs live OpenAPI 2026-08-16): Zo exposes exactly 4 endpoints** — `/zo/ask`, `/models/available`, `/models/catalog`, `/personas/available`; **no skills- or files-listing API**. Listing must be prompt-mediated via `/zo/ask` ("list your skills" / "list files at path X", JSON-enforced output, client-validated + cached: skills per session, dirs briefly) — workable but costs one LLM round-trip per listing and is non-deterministic; a real endpoint (`/skills/available`, personas pattern) is the clean fix if Zo adds one. Alt server-side route: extend zo.space `/api/cobrowse/*` (where DuckDB query lives) — outside this repo. `@` stays tabs; Zo-UI's `@`-files maps to `%`. Open questions for triage: skill invocation as prefix vs chip only; manifest metadata depth; cache invalidation; folder selection = one line vs recursive listing. |
