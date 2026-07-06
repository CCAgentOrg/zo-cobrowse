# Zo Co-browse: Preset Reference

Each preset pairs a **system prompt** (defines Zo's role) with
**instructions** (defines output format). The extension ships with
four built-in presets; users can create custom ones via the
sidepanel UI or this skill's generate-preset script.

## Built-in Presets

### 1. research — Research Deep-dive

**System Prompt**: Research assistant — deep analysis of page content.
**Behavior**: Extracts facts, claims, sources, dates, contradictions.
**Output**: Structured headings with markdown formatting.

For pages with: long-form analysis, whitepapers, investigative articles.

---

### 2. summarize — Summarizer

**System Prompt**: Summarization assistant — condense to essentials.
**Behavior**: 3-5 clear bullet points or one tight paragraph.
**Output**: Plain markdown.

For: news articles, blog posts, documentation pages.

---

### 3. qa — Q&A

**System Prompt**: Page content Q&A — answers strictly from visible text.
**Behavior**: Cites relevant passages. Says "not on this page" when
the answer isn't present.
**Output**: Plain text with quotes.

For: specific questions about page content.

---

### 4. scrape — Data Extraction

**System Prompt**: Data extraction assistant — clean, machine-readable output.
**Behavior**: Identifies tables, lists, contact info, prices, dates, links.
**Output**: Markdown tables or JSON.

For: product listings, comparison tables, directory pages, contact pages.

---

## Custom Presets

Created via the sidepanel's "Create Preset" button (or this skill's
generate-preset script). The process:

1. User describes the desired behavior in natural language
2. Zo generates: name, description, systemPrompt, instructions
3. The preset is stored in `chrome.storage.local` and appears in the
   sidepanel dropdown

Custom presets are not synced across devices (stored in local storage).

## Creating Presets via This Skill

```bash
# Run the sync/validate script
bun run skill/scripts/sync-presets.ts

# To push to a zo.space endpoint for extension consumption
ZO_ACCESS_TOKEN=... bun run skill/scripts/sync-presets.ts --push
```

For generating new presets with Zo:
```bash
# Use a one-shot Zo prompt
bun run -e "
const r = await fetch('https://api.zo.computer/zo/ask', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.ZO_ACCESS_TOKEN,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    input: 'Create a co-browse preset for extracting product reviews from shopping pages. Name it \"Review Analyzer\".',
    model_name: process.env.ZO_MODEL || undefined
  })
});
const data = await r.json();
console.log(data.output);
"
```

## Preset Schema

```json
{
  "name": "Display name (2-4 words)",
  "description": "One-sentence description shown in dropdown",
  "systemPrompt": "Paragraph defining Zo's role, starting with 'You are Zo —'",
  "instructions": "Output format instructions + JSON schema for actions"
}
```

## Persona Integration

Each preset can be used with either persona mode:

| Persona | Effect |
|---------|--------|
| Lite | Preset system prompt + plain text output. No actions. |
| Full | Preset system prompt + action JSON output. Zo can interact with browser. |

The persona routing is orthogonal to preset selection — presets
customize the **prompt**, personas customize the **capabilities**.
