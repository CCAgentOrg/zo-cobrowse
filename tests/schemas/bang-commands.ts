import { z } from "zod";

// Discriminated union for parseBangCommand() output, keyed on `kind`.
// Every code path in extension/lib/bang-commands.js must produce one of these.

const Passthrough = z.object({
  handled: z.literal(false),
  kind: z.literal("passthrough"),
});

const InlineReply = z.object({
  handled: z.literal(true),
  kind: z.literal("inline"),
  inlineReply: z.string().min(1),
});

const Save = z.object({
  handled: z.literal(true),
  kind: z.literal("save"),
  isSave: z.literal(true),
  savePath: z.string(),
});

const Automation = z.object({
  handled: z.literal(true),
  kind: z.literal("automation"),
  isAuto: z.literal(true),
  instruction: z.string(),
});

const ExpandedQuery = z.object({
  handled: z.literal(true),
  kind: z.literal("command"),
  query: z.string().min(1),
  preset: z.string().nullable(),
});

export const BangCommandResultSchema = z.discriminatedUnion("kind", [
  Passthrough,
  InlineReply,
  Save,
  Automation,
  ExpandedQuery,
]);

export type BangCommandResult = z.infer<typeof BangCommandResultSchema>;

export const BANG_COMMAND_NAMES = [
  "summarize",
  "extract",
  "research",
  "qa",
  "ask",
  "fill",
  "skills",
  "skill",
  "save",
  "auto",
] as const;
