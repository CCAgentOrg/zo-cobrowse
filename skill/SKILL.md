---
name: zo-cobrowse
description: >-
  Server-side companion for Zo Co-browse Chrome extension. Defines the
  Zo agent persona, preset library, and action schema protocol for
  browser co-browsing sessions. Includes tools to sync presets, classify
  intents, and generate new presets from natural language descriptions.
metadata:
  author: cashlessconsumer.zo.computer
  repo: https://github.com/CCAgentOrg/zo-cobrowse
  presets: 4 built-in, extensible via GENERATE_PRESET endpoint
  personas: cobrowse-lite (chat-only), Zo (full tool access)
---

# Zo Co-browse — Agent Skill

## Overview

This skill is the **Zo-side counterpart** to the Chrome extension at
`Projects/zo-cobrowse/`. It defines:

1. **Co-browse Personas** — how Zo behaves in lite vs full modes
2. **Preset Library** — canned system prompts for common tasks
3. **Action Schema** — the JSON protocol the extension sends/receives
4. **State Management** — conversation threading, context sizing

## How the Extension Uses This Skill

When a user sends a query from the browser, the extension:

1. **Classifies intent** (lite vs full) using keyword heuristics
2. **Resolves persona** — picks Zo persona (lite or full) based on
   personaMode setting (auto/lite/full)
3. **Sends prompt** to `/zo/ask` with page context + chosen persona
4. **Receives response** — either plain text (lite) or JSON actions (full)
5. **Executes actions** (click, fill, navigate, extract, scroll)

The personas and presets in this skill are the Zo-side configuration
that the extension references.

## Personas

### Lite: `c6d26798-3aea-4772-8762-8dcf7ac8e4b5`
- **Scope**: Chat-only (no tools)
- **Purpose**: Answer page questions, summarize, extract, translate
- **Behavior**: Concise, conversational, no action JSON
- **System Prompt**: `You are Zo — the user's browser companion...`
- **Context**: 2,000 chars of page text (lighter capture)

### Full: Zo (default, no persona override)
- **Scope**: All tools (files, data, skills, automations)
- **Purpose**: Multi-step tasks, data analysis, form filling, navigation
- **Behavior**: Returns JSON action objects for the extension to execute
- **Context**: 4,000+ chars of page text + form fields

### Custom (via Persona Routing settings)
- User can assign any Zo persona as lite or full
- Persona scopes determine what tools are available

## Preset Library

Four built-in presets are hardcoded in `extension/sidepanel.js`:

| ID | Name | Description |
|----|------|-------------|
| `research` | Research Deep-dive | Extract facts, data, sources from page |
| `summarize` | Summarizer | Condense page into bullet points |
| `qa` | Q&A | Answer questions about page content |
| `scrape` | Data Extraction | Extract structured data in JSON/tables |

Custom presets are generated at runtime via the `GENERATE_PRESET`
message and stored in `chrome.storage.local`.

The canonical preset definitions live in `assets/default-presets.json`.

## Action Schema (Full Mode)

When Zo decides to interact with the browser, it returns:

```json
{
  "reasoning": "step-by-step thinking before acting",
  "actions": [
    {
      "type": "navigate" | "click" | "fill" | "extract" | "scroll" | "wait" | "done" | "read_tab",
      "selector": "css-selector",
      "value": "text to type",
      "url": "https://...",
      "direction": "up" | "down",
      "amount": 300,
      "ms": 1000,
      "response": "final answer for user",
      "ref": "T1"
    }
  ]
}
```

Lite mode returns **plain text** — no action JSON.

### Referenced tabs + `read_tab` (context, not actions)

When the user references other tabs as context, the prompt carries a
`## Referenced Tabs` manifest — one line per tab (`[T1] title — host — size
hint` + a short excerpt). That is all you get by default; the full page text
is **not** attached. If you need a referenced tab's content to answer, return
`{"type": "read_tab", "ref": "T1"}`:

- The extension captures that tab and auto-sends its full text back into the
  conversation as a follow-up — then continue your answer.
- Budget: max 3 `read_tab` per user turn; repeated reads of an unchanged tab
  return "already provided above".
- `read_tab` is context-only. You cannot click/fill/extract in another tab;
  DOM actions always run in the tab the user is looking at.

## Use Cases

### 1. "Summarize this page" (Lite, 2s)
User clicks a chip → Zo summarizes in 1-2 sentences. No tool cost.

### 2. "Extract all tables to DuckDB" (Full, multi-step)
→ Zo navigates to page, extracts tables, queries them, returns results.

### 3. "Fill this form with test data" (Full, action sequence)
→ Zo fills form fields, clicks submit, returns what happened.

### 4. "Create a weekly summary automation for this dashboard" (Full, tool-heavy)
→ Zo creates a Zo automation that scrapes this page weekly.

## Scripts

### `scripts/sync-presets.ts`
Pushes the canonical preset definitions to the extension's
`chrome.storage.local` via an API call, so they can be loaded
without the extension being open. Useful for CI/CD or first-time setup.

```bash
bun run skill/scripts/sync-presets.ts
```

### `scripts/generate-preset.ts` (optional)
Uses `/zo/ask` to generate a new preset from a description and
appends it to `assets/default-presets.json`.

## References

- `references/presets.md` — Full preset definitions with example outputs
- `assets/default-presets.json` — Machine-readable preset data

## Related Files

| File | Purpose |
|------|---------|
| `Projects/zo-cobrowse/extension/background.js` | Intent classification, persona resolution |
| `Projects/zo-cobrowse/extension/sidepanel.js` | Preset loading, UI, message handling |
| `Projects/zo-cobrowse/extension/options.html` | Persona routing configuration UI |
| `Projects/zo-cobrowse/brainstorming/DESIGN.md` | Full design rationale for persona routing |

## Safety

- Lite persona has **zero tool access** — cannot read files, query data,
  create automations, or take external actions
- Full persona has full Zo capabilities — use with appropriate
  caution and persona scoping
- Conversation context is isolated per browsing session
