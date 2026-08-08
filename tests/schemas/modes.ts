import { z } from "zod";

// Mode schema — validates a Mode object (built-in or custom) in
// extension/lib/modes.js. A Mode is the single source of truth for how Zo
// behaves on a request and what page context it receives.

export const ModeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  description: z.string().optional().default(""),
  systemPrompt: z.string().min(1),
  instructions: z.string().min(1),
  // 0 = pointer, 1 = +text, 2 = +elements, 3 = +screenshot
  contextTier: z.number().int().min(0).max(3),
  textBudget: z.number().int().min(0),
  expectJson: z.boolean(),
  builtin: z.boolean(),
}).passthrough();

export type Mode = z.infer<typeof ModeSchema>;

export const ModeCatalogSchema = z.record(z.string(), ModeSchema);

// Built-in Mode ids — the canonical set shipped with the extension.
export const BUILTIN_MODE_IDS = [
  "cobrowse",
  "ask",
  "research",
  "summarize",
  "extract",
  "visual",
] as const;

// Bang-command Mode targets — the Mode ids a bang command may resolve to.
export const BANG_MODE_IDS = [
  "summarize",
  "extract",
  "research",
  "ask",
] as const;
