# Action Protocol

The **action protocol** is the contract between Zo and the extension: Zo
returns a JSON array of actions, and the extension executes them in the DOM.
The canonical shapes below are validated against the Zod schema in
[`tests/schemas/actions.ts`](https://github.com/CCAgentOrg/zo-cobrowse/blob/main/tests/schemas/actions.ts) — the single source of truth.

## Action types

Seven action types, discriminated by `type`:

### `navigate`

Go to a URL.

```json
{ "type": "navigate", "url": "https://example.com" }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `"navigate"` | ✅ | |
| `url` | string (valid URL) | ✅ | |

### `click`

Click an element identified by a CSS selector.

```json
{ "type": "click", "selector": "#pricing" }
```

| Field | Type | Required |
|-------|------|----------|
| `type` | `"click"` | ✅ |
| `selector` | string (min 1 char) | ✅ |

### `fill`

Fill an editable field with a value.

```json
{ "type": "fill", "selector": "input[name=email]", "value": "user@example.com" }
```

| Field | Type | Required |
|-------|------|----------|
| `type` | `"fill"` | ✅ |
| `selector` | string (min 1 char) | ✅ |
| `value` | string | ✅ |

The content script sets the value and dispatches both `input` and `change`
events so the page's listeners fire.

### `extract`

Extract data from an element.

```json
{ "type": "extract", "selector": "body", "attribute": "textContent" }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `"extract"` | ✅ | |
| `selector` | string | ✅ | |
| `attribute` | string | ❌ | If omitted, returns the element's `textContent` |

### `scroll`

Scroll the page.

```json
{ "type": "scroll", "direction": "down", "amount": 400 }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `"scroll"` | ✅ | |
| `direction` | `"up"` \| `"down"` | ❌ | Defaults to `down` |
| `selector` | string | ❌ | |
| `amount` | number | ❌ | Defaults to ~70% of viewport height |

### `wait`

Pause for a number of milliseconds (e.g. after a click that loads content).

```json
{ "type": "wait", "ms": 1500 }
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `"wait"` | ✅ | |
| `ms` | integer ≥ 0 | ❌ | Defaults to 1000 |

### `done`

Terminal action — signals the task is finished, carrying the final answer.

```json
{ "type": "done", "response": "The form was submitted successfully." }
```

| Field | Type | Required |
|-------|------|----------|
| `type` | `"done"` | ✅ |
| `response` | string | ✅ |

The `done.response` becomes the assistant's final prose.

## The compact action schema

When a mode requests JSON (`expectJson: true` — only **Co-browse**), the prompt
ships this compact schema so Zo knows exactly what to emit:

```
Respond with JSON {"actions":[...]}. Actions: click{selector} | fill{selector,value} |
extract{selector,attribute} | navigate{url} | scroll{direction,amount?} |
wait{ms} | done{response}.
```

## Normalization

Zo sometimes emits actions in a **non-canonical shape**. `normalizeActions()`
(in `extension/lib/modes.js`) converts all three to the canonical type-first
form:

| Input shape | Example | Result |
|-------------|---------|--------|
| Type-first (canonical) | `{ type: 'extract', selector: 'body', attribute: 'textContent' }` | Passes through unchanged |
| Key-first (Zo variant) | `{ extract: { selector: 'body', attribute: 'textContent' } }` | `{ type: 'extract', ... }` |
| `action` variant | `{ action: 'click', ... }` | `{ type: 'click', ... }` |

Without normalization these variants would silently drop out of every consumer
(`a.type === 'done'`, `executeActions`, the timeline) and the raw
`{actions:[...]}` blob would leak into the chat. Non-conforming entries are
**dropped** rather than risk raw JSON rendering.

## Execution

Actions execute either through:

1. **Content script** (`extension/content.js` → `executeDomAction`), via
   `chrome.tabs.sendMessage(..., EXECUTE_ACTION)` — the preferred path.
   `click` and `fill` use `waitForElement()` (a `MutationObserver` with a 5s
   timeout) so they work on elements that appear after the page settles.
2. **`chrome.scripting.executeScript`** — fallback when the content script
   isn't loaded yet (fresh tabs, `document_idle` injection not complete).

Actions auto-run as a batch when Zo returns them (`pendingActions` in the side
panel), with a per-action status timeline — pending → running → done.
