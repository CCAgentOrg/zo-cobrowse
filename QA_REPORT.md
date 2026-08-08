# Zo Co-browse — QA Report

**Round:** 2026-08-08 · **Branch:** `Rewritet` (HEAD `8b39459`) · **Scope:** Full codebase audit (extension, backend, tests, manifest) + live test run.

## Headline status

| Metric | Claimed (docs) | Actual (this run) |
|--------|----------------|-------------------|
| Tests | "126 passing, no failures" (AGENTS.md) / "140 pass, 0 fail" (old QA report) | **81 pass, 9 fail, 5 errors** |
| `bun test` | green | **red** — `tests/background.test.ts` is structurally broken |
| Working tree | — | clean |

The test suite is currently **failing**. A pre-existing structural bug in `tests/background.test.ts` collapses 4 tests; the prior QA reports' pass counts are stale. Every other test file passes.

## Test suite (live)

```
90 tests across 13 files — 81 pass, 9 fail, 5 errors, 213 expect() calls
```

**Single root cause of all 9 failures** — `tests/background.test.ts:99-129` has malformed brace nesting:
- `beforeEach(() => { ... })` is missing its closing brace, so the first `it(...)` blocks (`omnibox`, `duckdb`, `automation`, `save-page`) get parsed as the *body* of `beforeEach`.
- A stray `});` at line 129 then pushes `loads without errors`, `persists and retrieves config values`, `merges defaults with stored values`, `stores and retrieves complex config objects` into a scope that triggers `Cannot call test() inside a test`.
- Result: 4 of the 4 in-scope tests error out + 5 cascade errors. The 4 config tests never actually assert against the extension; they only assert against the chrome mock.

**Fix is mechanical** — close the `beforeEach` brace at line 102, remove the stray `});` at 129, and the file parses as two clean `describe` blocks.

---

## P0 — Critical (broken functionality / crashes)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| P0-1 | `tests/background.test.ts:99-129` | Test suite red — malformed `describe`/`beforeEach` nesting (verified). 9 failures. | Close `beforeEach` brace; remove stray `});` at line 129. |
| P0-2 | `background.js:600` | `ReferenceError: pageContext is not defined` in the default branch of `contextMenus.onClicked`. `pageContext` only exists block-scoped inside the `cobrowse-save` case (line 571), so every **non-save** context-menu action (page/selection/link/fill) throws in strict mode before the side panel is notified. | Remove `, context: pageContext` (the panel re-captures context itself), or capture context at the top of the listener. |
| P0-3 | `options.js:311-312` | `populatePersonas()` appends the **same** `<option>` node to two selects. `appendChild` moves the node, so every persona ends up only in `fullSelect`; the **Lite Persona dropdown is permanently empty**. | `fullSelect.appendChild(opt.cloneNode(true))`. |
| P0-4 | `config.js` DEFAULTS vs `background.js:552` vs `options.js` | `enabledMenus` key mismatch: DEFAULTS declares `fillField`, but menu gating indexes `menus[item.contexts[0]]` = `menus['editable']` and options writes `editable`. On a fresh install the **"Ask Zo to fill this field" menu item is silently hidden** despite the default intending it on. | Pick one key (`editable`) and use it in DEFAULTS, background DEFAULTS, options, and gating. |
| P0-5 | `sidepanel.js:1517-1520` | `addSystemMessage` injects `text` via `innerHTML +=` **without HTML-escaping** (only `safeText` stringifies). Callers feed backend/LLM-controlled data (`preset.name`, `resp.error`, etc.) → stored/reflected XSS. Also renders `**bold**` literally (no markdown), and `innerHTML +=` rebuilds the whole message tree, destroying TTS-button listeners. | HTML-escape + render via `markdownToHtml`, append with `appendChild` (route through `addMessageDOM('system', …)`). |

---

## P1 — High (real defects)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| P1-1 | `background.js:1-22` | `askZoStream` retry wrapper posts `STREAM_RECONNECT_DONE` **before** `STREAM_RECONNECT` and only on attempt > 1, and retries **non-retriable** errors (e.g. missing token) 3× with backoff. | Only retry transient (network/5xx) errors; emit `*_DONE` after the final attempt. |
| P1-2 | `background.js` `onConnect` (≈511) | No `port.onDisconnect` listener. If the panel closes mid-stream, every later `port.postMessage` throws "disconnected port object", and the retry wrapper fires 3 wasted API calls + ~7s backoff before throwing. | Track `port._dead`; skip `postMessage` and skip retry when dead. |
| P1-3 | `background.js:118` | `enabledMenus` is **not** in the startup `storage.sync.get([...])` keys array, so `config.enabledMenus` stays at DEFAULTS until the next `storage.onChanged`. Custom menus ignored after SW restart. | Add `'enabledMenus'` to the keys array. |
| P1-4 | `sidepanel.js:901` & `1926` | `sendQuery` is defined **twice**; the reassignment at 1926 shadows the original. ~120 lines of dead duplicate bang-command handling (its own `!save`/`!auto`/`!query`/`addDuckdbResult`) that can never run — a drift hazard. | Delete the dead first definition (901–1108). |
| P1-5 | `sidepanel.js:1712-1733` | `port.onDisconnect` clears `streamSession.active` and the thinking indicator but **does not re-enable `input`/`sendBtn`**. `sendQuery` disabled them (1930) and only the STREAM_DONE/STREAM_ERROR path re-enables — so a mid-stream disconnect leaves the panel input **permanently disabled** until reload. | Re-enable input/send in the disconnect handler. |
| P1-6 | `background.js:962` / `sidepanel.js:1737` | Background's `STREAM_DONE` carries no `sessionId`, so `handleStreamMessage`'s guard (`if (msg.sessionId && msg.sessionId !== …) return;`) cannot reject it. A late DONE from a **previous** query can render into the current conversation (the historical "Done."-duplication bug class). | Echo `sessionId` on every STREAM_* message in background; add the guard to the STREAM_DONE branch in sidepanel. |
| P1-7 | `sidepanel.js:1183-1206` | The action loop reads `pendingActions.length` each iteration, but the Skip button sets `pendingActions = null` (line 477). Clicking Skip during an `await` makes the next iteration throw `Cannot read properties of null`. | Snapshot `const actions = pendingActions` at top; `if (!pendingActions) break;` after each await. |
| P1-8 | `content.js:101-162` | `executeAction()` has no `navigate`/`done` case (advertised by background's prompt schema) and the `onMessage` listener has no `default:` — unknown request types cause the caller's `sendMessage` promise to reject ("message port closed before a response received"). | Add explicit no-op `navigate`/`done` cases + a `default:` that sends `{ ok:false }`. |
| P1-9 | `options.html:377-383` | Keyboard-shortcut table lists `Ctrl+Shift+K`/`Ctrl+Shift+L` — none of which exist in the manifest (actual: `Z`/`S`/`N`/`E`). Table omits summarize/extract/new-chat. | Regenerate from manifest `commands`. |
| P1-10 | `options.js` | **No "Reset to defaults"** and **no onboarding reset** (both referenced by CHECKLIST.md as expected). Also **no UI for `zoApiUrl`**, which background reads as the endpoint for every API call — users can't override the endpoint. | Add reset button + endpoint field (or document why it's hidden). |

---

## P2 — Medium (robustness / correctness / dead code)

| # | Location | Issue |
|---|----------|-------|
| P2-1 | `background.js:860-908` | Duplicate End/done handling; line 905-906 overwrites accumulated `fullText` with `parsed.output`, risking silent data loss when the server streams incrementally AND sends a final payload. Guard: don't overwrite non-empty `fullText`. |
| P2-2 | `background.js:470` | `captureVisibleTab(tab.windowId, …)` — when `tab` is synthesized as `{ id: tabId }` (from EXECUTE_ACTIONS / save menu, line 386), `windowId` is `undefined` → wrong-window screenshot. |
| P2-3 | `background.js:201-220` | `NAVIGATE`/`EXECUTE_CONTENT_SCRIPT` don't validate `tabId` (passes `undefined` to `chrome.tabs.update`) and `EXECUTE_CONTENT_SCRIPT` passes `request.func` to `executeScript` with no callers in tree — dead handler. |
| P2-4 | `background.js:1110-1118` | `testConnection` reads body unconditionally and overwrites `zoOk` via `body.includes('ZO_OK')` — casing not normalized, so a valid response without the literal flips to fail. |
| P2-5 | `background.js:36, 1034, 1049` | `listModels`/`listPersonas` hardcode `api.zo.computer` instead of deriving from `config.zoApiUrl` — breaks self-hosted/overridden endpoints. |
| P2-6 | `sidepanel.js:113-117, 10-12` | Dead streaming state: `zoPort`, `streamSessionId`, `streamActive`, `streamMsgEl`, `streamAccumulated`, `THINKING_TIMEOUT_MS`, `thinkingTimeout` — all declared, never used. The thinking indicator therefore has **no timeout** (compounds P1-5). |
| P2-7 | `sidepanel.js:536-542` | `migrateOldFormat` calls `firstUserMsg.text.substring(0,60)` without coercion; a `user` msg with non-string `text` throws and (caught+swallowed) leaves conversations unloaded → empty panel. |
| P2-8 | `sidepanel.js:1796-1842` | STREAM_DONE with actions can leave the rendered body showing the last partial chunk instead of `responseText`; saved conversation and rendered DOM can diverge; possible double-render via `handleStreamActions`. |
| P2-9 | `config.js:20` | `STORAGE.CONVERSATIONS = 'zoConversations'` is dead — sidepanel uses `'cobrowse_convos'`. Also `zoTtsVoice` is read/consumed in sidepanel but has no DEFAULTS entry, no STORAGE key, and no options UI. |
| P2-10 | `manifest.json:94-97` | `sandbox` CSP includes `'unsafe-eval'`/`'unsafe-inline'` but no page is marked `sandbox.pages` — the directive is inert and unjustified. Remove it. |
| P2-11 | `options.js:195` | `zoTtsRate` read from `type="text"` input, stored as string; DEFAULTS is a number. Use `type="number" min="0.5" max="2" step="0.1"`. |

---

## P3 — Low (polish / hardening)

- `sidepanel.js:937,1958` — `addMessage('bot', …)` falls through to plain textContent (only `assistant`/`system`/`thinking` get markdown). `!help` output renders as raw text. Use `'assistant'`.
- `styles.css` — missing CSS for `.action-card`, `.action-icon`, `.action-status`, `.pending/.running/.done/.error`, `.duckdb-result`, `.db-table`, `.db-table-wrap`, `.db-sql`, `.msg-action`. Timeline + DuckDB tables render unstyled.
- `sidepanel.js:399-404` — routing badge initial HTML says `auto` then `updateRoutingBadge` repaints to `Auto`; unknown `personaMode` value shows `undefined` (only falsy falls back).
- `background.js:157-161` — redundant `action.onClicked` → `sidePanel.open` (already covered by `setPanelBehavior({openPanelOnActionClick:true})`). Dead code.
- `background.js:323-344` — `makeCaptureContextEval` defined, zero callers. Dead.
- `background.js:39,1388`, `config.js` — default `zoSpaceEndpoint = 'https://cashlessconsumer.zo.space'` is a tenant-specific URL baked in as a global default.
- `background.js:813,823` — fire-and-forget `chrome.storage.session.set` without `.catch` (other call sites have it).
- `manifest.json` — `icon32.png`/`icon256.png` exist but are unreferenced (harmless). `debugger` permission is used (CDP eval) but shows a user-visible "is being debugged" banner — worth a privacy note.

---

## What's solid

- **Message protocol is consistent.** Every one of the 13 runtime message types sidepanel.js sends (`GET_CONFIG`, `GET_PAGE_CONTEXT`, `LIST_MODELS`, `LIST_PERSONAS`, `ASK_ZO`, `NEW_CONVERSATION`, `NAVIGATE`, `EXECUTE_ACTIONS`, `GENERATE_PRESET`, `SAVE_PAGE`, `CREATE_AUTOMATION`, `DUCKDB_QUERY`) plus the port `ASK_ZO` has a `case` in background.js. No orphan handlers.
- **Bang commands fully dispatched.** All kinds from `parseBangCommand` (`passthrough`, `inline`, `save`, `automation`, `duckdb`, `command`) are handled — `!summarize/extract/research/qa/ask/fill/skills/skill/save/auto/query/data/help/autos` all route. Verified.
- **`safeText`/String() coercion** is applied at every text output sink *except* `addSystemMessage` (P0-5). The historical `[object Object]` bug class is otherwise closed.
- **Permissions are all exercised.** `debugger` (CDP eval), `tts` (sidepanel speak), `contextMenus`, `sidePanel`, `storage`, `tabs`, `scripting`, `activeTab` all have real callers.
- **Icons referenced in manifest all exist.**
- **Zod contract tests** (`message-contract.test.ts`) guard the background↔content↔sidepanel boundary and pass.

---

## Recommended fix order

1. **P0-1** (fix the test file) — unblocks the suite, gives a safety net for everything else.
2. **P0-2…P0-5** — context-menu crash, persona dropdown, fill-menu, XSS. Each is a small, isolated change.
3. **P1-2 / P1-5 / P1-6** — streaming port lifecycle (disconnect handling + sessionId). These are the remaining instances of the recurring "Done."-bug class.
4. **P1-4** — delete dead `sendQuery` (reduces risk of future drift in P1-3/6 fixes).
5. Then P1-1, P1-3, P1-7…P1-10 and the P2 batch.

See `BACKLOG.md` for the full prioritized work list.
