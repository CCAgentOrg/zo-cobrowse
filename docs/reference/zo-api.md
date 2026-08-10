# Zo API Reference

The extension talks to Zo's HTTP + SSE API at `https://api.zo.computer`. This
is a distilled, reader-friendly version of the authoritative reference in
[`extension/AGENTS.md`](https://github.com/CCAgentOrg/zo-cobrowse/blob/main/extension/AGENTS.md).

The full OpenAPI spec is downloadable at
<https://www.zo.computer/docs-assets/openapi.json>.

## Base URL & authentication

- **Base URL:** `https://api.zo.computer`
- **Auth:** `Authorization: Bearer <token>` — tokens are `zo_sk_...` and are
  created at **Zo → Settings → Advanced → Access Tokens**.

## Endpoints

### `POST /zo/ask`

Send a message to Zo. Zo has full access to files, tools, and integrations —
this is the "AI Brain" channel.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | string | ✅ | Your message to Zo |
| `conversation_id` | string | ❌ | Continue an existing conversation thread |
| `model_name` | string | ❌ | Override model (see `GET /models/available`) |
| `persona_id` | string | ❌ | Override persona (see `GET /personas/available`) |
| `output_format` | object | ❌ | JSON Schema for structured output — when set, `output` becomes an object instead of a string |
| `stream` | boolean | ❌ | Enable SSE streaming. Defaults to `false` |

**Response (non-streaming):**

```json
{
  "output": "string | object",
  "conversation_id": "conv_..."
}
```

**Streaming** (`stream: true`) returns an SSE stream with
`Content-Type: text/event-stream`; the conversation id is in the
`x-conversation-id` response header. See [Streaming](../concepts/streaming) for
the event model.

### `GET /models/available`

List the models you can use (includes BYOK configs). Requires auth.

**Response:**

```json
{
  "models": [{
    "model_name": "anthropic:claude-haiku-4-5-20251001",
    "label": "Haiku 4.5",
    "vendor": "Anthropic",
    "description": "string | null",
    "type": "fast | capable | null",
    "context_window": 200000,
    "is_byok": false
  }]
}
```

### `GET /models/catalog`

Full public model catalog. **No auth required.** Cached for 5 minutes.

Response extras: `default_chat_model_id`, `featured_model_ids`,
`featured_models_are_free`, `featured_model_labels`, `promo_end_date`,
`deprecation_map`.

### `GET /personas/available`

List configured personas. Requires auth.

```json
{
  "personas": [{
    "id": "a1b2c3d4",
    "name": "Technical Writer",
    "prompt": "System prompt text...",
    "model": "anthropic:claude-sonnet-4 | null",
    "image": "url | null"
  }]
}
```

## The `{reasoning, actions}` envelope

Only the **Co-browse** mode requests structured actions. It asks Zo for a JSON
array `{"actions":[...]}` in the prompt text (there is **no `output_format`**
in the actual extension calls — Zo didn't support `array` types in the schema),
then `background.js` parses it from the text response.

The action object may arrive in one of three shapes — all are normalized:
- Key-first: `{"click":{...}}`
- Type-first: `{"type":"click",...}`
- Non-spec `action` variant: `{"action":"click",...}`

See [Action Protocol](../reference/actions).

## SSE event types (live-captured)

These are the event types the **live** API actually emits (captured
2026-08-09). The older-documented `FrontendModelResponse` / `End` / `Error`
events are **never emitted** by the live API — handlers remain only for
synthetic test fixtures.

| Event | Purpose |
|-------|---------|
| `PartStartEvent` | Starts a content part. `data: {event_kind:"part_start", index, part:{part_kind:"thinking\|text\|tool-call\|tool-return", content:"<first piece>"\|args}, previous_part_kind}`. The first token must be routed by `part_kind` or it's lost |
| `PartDeltaEvent` | Incremental content delta (the workhorse). `data: {event_kind:"part_delta", index, delta:{content_delta:"<text>", part_delta_kind:"thinking\|text"}}`. Route on `part_delta_kind`: `thinking` = live reasoning (index 0), `text` = answer (index 1) |
| `FunctionToolCallEvent` | A tool was invoked. `data: {event_kind:"function_tool_call", part:{tool_name, tool_call_id, args}}` — surfaced as the "Explored" channel |
| `FunctionToolResultEvent` | A tool returned. `data: {event_kind:"function_tool_result", result:{content:{stdout,stderr,returncode}\|string, outcome:"success"\|"error", tool_call_id, tool_name}}` |
| `AgentRuntimeStreamChunk` | Lifecycle metadata. `data: {type:"status"\|"persisted", status, data:{message_id}}` — not rendered |
| `completed` | **Terminal** signal. `data: {status:"succeeded"|"failed", error}` (not `End`, not `[DONE]`) |

## Official features the extension doesn't (yet) use

| Feature | Official support | Extension state | Priority |
|---------|------------------|-----------------|----------|
| `output_format` | First-class JSON Schema | Prompt-based JSON parse (fragile) | P0 |
| `stream: true` | SSE typed events | **Used** — primary path | P1 (done) |
| `GET /models/catalog` (no-auth) | Public catalog | Only `/models/available` is used | P2 |
| `featured_models_are_free` | Free-model flag | Not checked | Low |
| `deprecation_map` | Active→successor mapping | Not used | Low |
| Persona `model` override | Persona can set own model | Not honored | P3 |

## Known gotchas

- `output_format` doesn't support `array` property types — the extension prompts
  for JSON and parses from text, so the model sometimes returns plain text and
  the panel handles both.
- Host permissions must include `<all_urls>` for `scripting.executeScript` to
  work on arbitrary pages — otherwise context capture fails silently.
- Config lives in `chrome.storage.sync`, history in `chrome.storage.local`
  (capped at 50 entries).
