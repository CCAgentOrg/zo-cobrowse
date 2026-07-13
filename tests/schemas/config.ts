import { z } from "zod";

// Config schema — validates the DEFAULTS object in background.js and the
// shape persisted to chrome.storage.sync.

export const ConfigSchema = z.object({
  zoApiUrl: z.string().url(),
  zoModel: z.string(),
  zoSpaceEndpoint: z.string(),
  zoPersonaId: z.string(),
  zoLitePersonaId: z.string(),
  zoFullPersonaId: z.string(),
  personaMode: z.enum(["auto", "lite", "full"]),
  zoAccessToken: z.string(),
  enableScreenshots: z.boolean(),
  enabledMenus: z.record(z.string(), z.boolean()),
}).passthrough();

export type Config = z.infer<typeof ConfigSchema>;
