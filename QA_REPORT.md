# Zo Co-browse — QA Report

**Round:** 2026-08-08 · **Branch:** `Rewritet` · **Scope:** Full codebase audit (extension, backend, tests, manifest) + remediation of all findings.

## Headline status (after remediation)

| Metric | Before this round | After this round |
|--------|-------------------|------------------|
| `bun test` | ❌ red — 81 pass / 9 fail / 5 errors | ✅ **green — 147 pass / 0 fail** (465 expect() calls) |
| Tests added | — | +3 (options reset + shortcut-docs assertions) |
| P0 findings | 5 open | **0 open** |
| P1 findings | 10 open | **0 open** |
| P2 findings | 11 open | **0 open** (B-31 deferred as documented design decision) |
| P3 findings | 7 open | **0 open** |
| Working tree | clean | clean |

9 atomic commits on `Rewritet` from `b31f3de` → `e036b81`.

> **2026-08-09 — Infrastructure round (no code changes, all green replay):**
> `bun run verify` aggregate gate (`scripts/verify.sh` = tests → release checks →
> per-entry `bun build` transpile) + a committed **hard-gate pre-commit hook**
> (`bun run setup-hooks` installs; `git commit --no-verify` bypasses). CI
> (`.github/workflows/ci.yml`) now runs on **every branch push** + PR to `main`
> and replaces the weaker `node --check` loop with a `bun build` transpile check;
> release publishing moved out of CI into a dormant, tag-triggered
> `.github/workflows/release.yml`. Suite: **274 tests / 0 fail** (19 files,
> 783 expects). See `CHANGELOG.md` `[Unreleased]`.

> **2026-08-14 — Prompts feature round (`feature/prompts`):**
> Prompts to Zo are now **reviewable, customizable, and token-efficient**.
> (1) `buildPrompt` extracted from background.js into the pure
> `extension/lib/prompt.js` (byte-identical; parity tests lock the output; the
> duplicated copy in `tests/test-prompts/capture.ts` is deleted) +
> `describePrompt()` structured view. (2) **Opt-in DOM + send-once** via the
> new `extension/lib/context-policy.js#decideTurn`: read turns send URL/title
> only (tier 0) by default; `!context`/`!dom` attaches full context for one
> turn; action turns attach on first turn / page-hash change and dedupe after
> (relying on `conversation_id` threading). `effectiveTier` rides the existing
> `ASK_ZO` payload (no new message types — the bidirectional contract test
> stays green by construction). (3) **Side-panel prompt inspector** — live,
> collapsible preview of the exact prompt + policy reason + approx tokens.
> (4) **Settings ✎ Prompts card** — edit each Mode's 5 knobs with a live
> preview; built-ins persist sparse overrides to `cobrowse_mode_overrides`
> (`mergeOverride` in modes.js; originals never mutated). (5) content.js
> `captureContext(tier)` now honors the requested tier (was always tier-2
> sized). Post-review fixes: `refreshPageContext` now resolves the Mode WITH
> overrides (Settings tier-raises actually capture) and the inspector honors
> mode-switching bangs. Behavior change (intended): read modes no longer ship
> page text by default — the inspector surfaces the decision. Suite: **594
> tests / 0 fail** (27 files, 1531 expects) + `bun run verify` fully green.

## Test suite

```
147 tests across 13 files — 147 pass, 0 fail, 465 expect() calls
```

Every extension JS file (`background.js`, `sidepanel.js`, `content.js`, `options.js`) transpiles cleanly via `bun build`. The message-protocol contract test (`message-contract.test.ts`) and Zod manifest schema both validate the current code.

---

## Remediation log (all findings from the audit round)

### P0 — Critical ✅ all fixed
| ID | Was | Fix | Commit |
|----|-----|-----|--------|
| P0-1 | Test suite red: malformed `describe`/`beforeEach` nesting in `background.test.ts` | Closed `beforeEach` brace, removed stray `});` | `b31f3de` |
| P0-2 | `ReferenceError: pageContext` on every non-save context-menu action (`background.js:600`) | Removed the undefined ref; panel re-captures context itself | `ccf059c` |
| P0-3 | Lite Persona dropdown permanently empty — same `<option>` moved between selects | `cloneNode(true)` into the second select | `ccf059c` |
| P0-4 | "Fill this field" menu hidden — `enabledMenus` key mismatch (`fillField` vs `editable`) | Unified on `editable` in DEFAULTS, background, options | `ccf059c` |
| P0-5 | `addSystemMessage` XSS + markdown bypass + DOM thrash | Route through `addMessageDOM('system')` (escapes + markdown + appendChild) | `5d842b9` |

### P1 — High ✅ all fixed
| ID | Was | Fix | Commit |
|----|-----|-----|--------|
| P1-1/6/8/11 | Streaming port lifecycle: stale-port throws, no disconnect handling, retries non-retriable errors, sessionId not echoed | `safePost()` helper + `port.onDisconnect`/`_dead`; echo `sessionId` on every STREAM_*; `isRetriableStreamError()`; re-enable input on disconnect | `486d496` |
| P1-7 | Late DONE from previous query could render into current chat | background now sends `sessionId` on every message; sidepanel's top guard rejects stale sessions | `486d496` |
| P1-9 | Dead duplicate `sendQuery` (~120 LOC) shadowed by streaming version | Deleted the dead original | `b476f6d` |
| P1-10 | Action loop threw if Skip clicked mid-await (`pendingActions = null`) | Snapshot to local `actions`; break when `pendingActions` null | `b476f6d` |
| P1-12 | `enabledMenus` not loaded on SW startup | Added to startup `storage.sync.get` keys | `b476f6d` |
| P1-13 | content.js had no `navigate`/`done` cases + no `default` | Added explicit cases + default response | `b476f6d` |
| P1-14 | Keyboard-shortcut docs in options.html wrong (K/L, missing S/N/E) | Regenerated to match manifest (Z/S/N/E, Ctrl+Cmd) + test | `89a17b1` |
| P1-15 | No "Reset to defaults" | Added reset button clearing sync+local config + test | `89a17b1` |

### P2 — Medium ✅ all fixed (B-31 deferred by design)
| ID | Was | Fix | Commit |
|----|-----|-----|--------|
| P2-1/16 | `fullText` overwritten by final payload (data loss) | `if (!fullText)` guards | `486d496` |
| P2-2/17 | `captureVisibleTab(tab.windowId)` undefined for synthesized tab | `chrome.tabs.get(tabId)` lookup | `519e279` |
| P2-3/18 | NAVIGATE passed undefined tabId; dead EXECUTE_CONTENT_SCRIPT | Validate tabId+url; removed dead handler + schema entry | `519e279` |
| P2-4/19 | `testConnection` casing bug | Case-insensitive `ZO_OK` + trust `r.ok` | `519e279` |
| P2-5/20 | listModels/listPersonas hardcoded host | `apiOrigin()` derives from `config.zoApiUrl` | `519e279` |
| P2-6/21 | Dead streaming state vars + no thinking-indicator timeout | Deleted dead vars; wired 60s timeout | `1ffd2d8` |
| P2-7/22 | `migrate`/`save` title `.substring` threw on non-string | `String(... \|\| '')` coercion | `1ffd2d8` |
| P2-8/23 | STREAM_DONE body lingered on partial chunk | Normalize body to `responseText` | `1ffd2d8` |
| P2-9/24 | Dead `STORAGE.CONVERSATIONS`; orphan `zoTtsVoice` | Removed dead key; added TTS_VOICE to DEFAULTS/STORAGE | `1ffd2d8` |
| P2-10/25 | Unjustified sandbox CSP `'unsafe-eval'` | Removed the sandbox directive | `1ffd2d8` |
| P2-11/26 | `zoTtsRate` stored as string | `type=number` input with min/max/step | `1ffd2d8` |
| P2-31 | Default `zoSpaceEndpoint` is tenant-specific (`cashlessconsumer.zo.space`) | **Deferred** — this is the documented working integration host (AGENTS.md references it as the landing page); changing it would break the active setup. Override is available via the `#space-endpoint` field. |

### P3 — Low ✅ all fixed
| ID | Was | Fix | Commit |
|----|-----|-----|--------|
| P3-27 | `addMessage('bot')` skipped markdown | Use `'assistant'` role | `e036b81` |
| P3-28 | Action timeline + DuckDB tables rendered unstyled | Added full CSS (`.action-card` states, `.db-table`, `.duckdb-result`) | `e036b81` |
| P3-29 | Badge showed `undefined` for unknown personaMode | Normalize unknown → `'auto'` | `e036b81` |
| P3-30 | Redundant `action.onClicked` + dead `makeCaptureContextEval` | Both removed | `e036b81` |
| P3-32 | Last fire-and-forget `storage.session.set` without `.catch` | Added `.catch` | `e036b81` |
| P3-33 | Unused icons (`icon32`, `icon256`) | Harmless; left as-is. `debugger` permission privacy note: it's required for the CDP eval fast-path and Chrome shows a standard "is being debugged" banner. |

### Feature — Thinking/reasoning bubble ✅ shipped
The `reasoning` field Zo returns alongside `actions` was flowing end-to-end (`background.js:finishStream` → `STREAM_DONE.reasoning` → sidepanel) but was invisible for text-only `done` responses — only surfaced truncated-to-200-chars in the `#actions-reasoning` in-action status bar when DOM actions ran.

| Aspect | Implementation |
|--------|----------------|
| Rendering | New `addReasoningBubble(parentMsgEl, reasoning)` in sidepanel.js — a collapsible "💭 Thinking" bubble (collapsed by default, click to expand), inserted above the assistant `.msg-body`. Rendered through `markdownToHtml` + `safeText` (same text-safety path as assistant messages). |
| Coverage | Hooked into all three assistant-finalize paths: streaming `STREAM_DONE` (live `msgEl`), the no-chunks `STREAM_DONE` fallback, the inactive-session late-DONE fallback, and the non-streaming `askZo()` fallback. |
| Persistence | Reasoning persisted with the assistant message (`{role, text, reasoning, timestamp}`) in both streaming and non-streaming write paths; re-rendered from history in `renderMessages` and `switchToConversation`. |
| Graceful degradation | `addReasoningBubble` no-ops on empty/whitespace reasoning, so plain-markdown modes (which don't request a `reasoning` field) are unaffected. Old history without `reasoning` is unaffected. |
| 2026-08 declubbing | All read-only modes (`ask`/`research`/`summarize`/`extract`/`visual`) now set `expectJson:false` → they stream **plain markdown** with no `{reasoning,actions}` envelope (matches zo.computer's own chat UI, where thinking + answer stream as separate blocks). Only `cobrowse` keeps JSON, and `ACTION_SCHEMA_COMPACT` now requests `{"actions":[...]}` **without** demanding `reasoning` — the old `{"reasoning","actions"}` prompt is what made the model club thinking + answer into one blob (the raw-JSON-in-chat bug). Reasoning still surfaces as a Thought bubble when the backend sends it. |
| Tests | `tests/sidepanel.test.ts` (8 source-containment assertions for the helper, CSS, persistence field, history re-render) + `tests/sse-parsing.test.ts` (3 vm-extraction tests confirming `reasoning` survives `finishStream` into `STREAM_DONE` for object/JSON-string output, plus the `safePost` dead-port contract). |
| Not changed | No new `STREAM_REASONING` incremental-stream type — reasoning arrives only in the final `STREAM_DONE`. The existing `#actions-reasoning` in-action status bar is left as-is (different purpose: in-action status during DOM execution). |

---

## Streaming support — current architecture (verified)

The streaming path (`background.js` `askZoStream` / `_askZoStreamImpl` ↔ `sidepanel.js` `streamPort` / `handleStreamMessage`) is now hardened end-to-end:

1. **Session isolation** — sidepanel increments `streamSession.sessionId` per query and stamps it on every `ASK_ZO`. Background echoes `sessionId` on **every** STREAM_CHUNK/DONE/ERROR/RECONNECT. The top-of-handler guard `if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;` rejects all stale messages, including late DONEs (the historical "Done." duplication bug).
2. **Port disconnect safety** — `port.onDisconnect` marks `port._dead`; `safePost()` no-ops on dead ports instead of throwing. `askZoStream` stops immediately (no more wasted API calls) when the port is gone. Sidepanel's disconnect handler re-enables input/sendBtn and clears the thinking timeout.
3. **Retry correctness** — `isRetriableStreamError()` only retries transient (network/5xx) errors; 4xx and config errors throw immediately. `STREAM_RECONNECT` is now sent before a retry (not the inverted `*_DONE`-first ordering).
4. **No silent data loss** — accumulated `fullText` is no longer clobbered by a final payload; STREAM_DONE normalizes the rendered body to the canonical `responseText`.
5. **Liveness guard** — a 60s thinking-indicator timeout fires if background never replies, removing the indicator and re-enabling input.

## What's solid (unchanged)

- **Message protocol consistent** — all 15 runtime message types sidepanel sends have background handlers; contract test enforces this bidirectionally.
- **Bang commands fully dispatched** — all kinds from `parseBangCommand` route correctly.
- **`safeText`/String() coercion** at every text output sink.
- **All permissions exercised** (debugger, tts, contextMenus, sidePanel, storage, tabs, scripting, activeTab).
- **Zod contract tests** guard manifest + message + action + config boundaries.

## Recommendation

The extension is green-tested with a hardened streaming path. Remaining work is new feature development (Tier 1: #16 Scheduled AI Commands, #17 Web Monitoring, #18 Shared Sessions) — these will reuse the now-stable streaming and persona-selector surfaces.
