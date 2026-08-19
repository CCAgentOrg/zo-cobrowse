import { z } from "zod";

// Link-extraction contracts — validates the output of extension/lib/links.js
// (URLs pulled from an assistant answer for the link-chips card + "Open all").
// See docs/superpowers/specs/2026-08-15-cold-start-open-all-design.md

/** One extracted URL: exact match + its hostname (chip label). */
export const ExtractedLinkSchema = z.object({
  url: z.string().regex(/^https?:\/\//i),
  host: z.string(),
});
export type ExtractedLink = z.infer<typeof ExtractedLinkSchema>;

export const ExtractedLinksSchema = z.array(ExtractedLinkSchema);
