import { z } from "zod";

/**
 * A single entry in the prompts catalog (prompts.json).
 */
export const PromptsCatalogEntry = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  mode: z.string().min(1),
  query: z.string().min(1),
  tier: z.number().int().min(0).max(3),
  expectJson: z.boolean(),
  expectShape: z.enum(["action-envelope-json", "plain-markdown"]),
  note: z.string().optional(),
});
export type PromptsCatalogEntry = z.infer<typeof PromptsCatalogEntry>;

export const PromptsCatalog = z.array(PromptsCatalogEntry);
export type PromptsCatalog = z.infer<typeof PromptsCatalog>;

/**
 * Metadata saved alongside a raw .sse fixture after a live capture.
 */
export const CaptureMetadata = z.object({
  id: z.string(),
  request: z.object({
    prompt: z.string(),
    model_name: z.string().optional(),
    stream: z.literal(true),
    conversation_id: z.string().optional(),
    persona_id: z.string().optional(),
  }),
  response: z.object({
    x_conversation_id: z.string().optional(),
    content_type: z.string().optional(),
    status: z.number(),
  }),
  summary: z.object({
    eventCount: z.number(),
    eventTypes: z.array(z.string()),
    firstChunkFields: z.array(z.string()).optional(),
    endPayload: z.union([z.literal("{}"), z.literal("absent"), z.string()]).optional(),
    hasActions: z.boolean(),
    hasReasoning: z.boolean(),
    assembledFullText: z.string().optional(),
  }),
});
export type CaptureMetadata = z.infer<typeof CaptureMetadata>;

/**
 * A single SSE event parsed from a raw fixture file.
 */
export const FixtureEvent = z.object({
  event: z.string().optional(),       // event type (FrontendModelResponse, End, Error, or empty for data-only)
  data: z.string(),                   // raw data line after "data: "
  parsed: z.any().optional(),         // JSON.parse result (null if not JSON)
});
export type FixtureEvent = z.infer<typeof FixtureEvent>;

export const FixtureEventSequence = z.array(FixtureEvent);
export type FixtureEventSequence = z.infer<typeof FixtureEventSequence>;

/**
 * A STREAM_* message emitted by the background.js replay path.
 */
export const StreamChunk = z.object({
  type: z.literal("STREAM_CHUNK"),
  text: z.string(),
});
export const StreamDone = z.object({
  type: z.literal("STREAM_DONE"),
  reasoning: z.string().optional(),
  actions: z.array(z.any()).optional(),
  fullText: z.string(),
});
export const StreamError = z.object({
  type: z.literal("STREAM_ERROR"),
  error: z.string(),
});
export const StreamReconnect = z.object({
  type: z.literal("STREAM_RECONNECT"),
  attempt: z.number(),
  maxRetries: z.number(),
});
// Live reasoning channel (PartDeltaEvent part_delta_kind:"thinking").
export const StreamReasoning = z.object({
  type: z.literal("STREAM_REASONING"),
  text: z.string(),
});
// Live "Explored" channel — one message per FunctionToolCall/Result event.
export const StreamTool = z.object({
  type: z.literal("STREAM_TOOL"),
  phase: z.enum(["call", "result"]),
  callId: z.string().nullable().optional(),
  toolName: z.string().nullable().optional(),
  args: z.string().optional(),
  result: z.string().optional(),
  outcome: z.string().optional(),
});

export const StreamMessage = z.discriminatedUnion("type", [
  StreamChunk,
  StreamDone,
  StreamError,
  StreamReconnect,
  StreamReasoning,
  StreamTool,
]);
export type StreamMessage = z.infer<typeof StreamMessage>;

/**
 * Result of replaying a fixture through the real parsers.
 */
export const ReplayResult = z.object({
  messages: z.array(StreamMessage),
  terminal: z.union([z.literal("done"), z.literal("error"), z.literal("reconnect-timeout")]),
  finalFullText: z.string().optional(),
  finalReasoning: z.string().optional(),
  finalActions: z.array(z.any()).optional(),
});
export type ReplayResult = z.infer<typeof ReplayResult>;

/**
 * Guard: fullText must not be a raw JSON dump of the action envelope.
 * The historical bug (ticket #29 / raw JSON in chat) is tested by asserting
 * fullText does NOT contain these structural markers unless it's an error message.
 */
export function isRawActionJsonLeak(text: string): boolean {
  const t = typeof text === "string" ? text.trimStart() : "";
  if (!t.startsWith("{")) return false;
  // If it starts with `{` and contains `"actions"` or `"reasoning"` as JSON keys
  // (not within a code block), it's likely leaked raw JSON.
  return /["']actions["']\s*:/.test(t) || /["']reasoning["']\s*:/.test(t);
}
