import { z } from "zod";

// Prompt assembly contracts — validates the structured output of
// extension/lib/prompt.js#describePrompt (used by the side-panel inspector
// and the Settings editor). The plain prompt string itself is validated by
// behavioral assertions in tests/prompt.test.ts rather than a schema, since
// it is free-form text.

export const SECTION_IDS = [
  "system",
  "page",
  "content",
  "elements",
  "forms",
  "screenshot",
  "userRequest",
  "tail",
] as const;

export const PromptSectionSchema = z.object({
  id: z.enum(SECTION_IDS),
  label: z.string().min(1),
  included: z.literal(true), // _groupSections only emits sections that are present
  editable: z.boolean(),
  text: z.string(),
  meta: z.string().optional(),
});
export type PromptSection = z.infer<typeof PromptSectionSchema>;

export const DescribedPromptSchema = z.object({
  prompt: z.string(),
  sections: z.array(PromptSectionSchema),
  tier: z.number().int().min(0).max(3),
  intent: z.enum(["action", "read"]),
  expectJson: z.boolean(),
  downgradeApplied: z.boolean(),
  approxTokens: z.number().int().min(0),
}).passthrough();
export type DescribedPrompt = z.infer<typeof DescribedPromptSchema>;
