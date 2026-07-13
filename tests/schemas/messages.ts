import { z } from "zod";

// Message protocol — the contract between sidepanel/content/options and background.
// Every `chrome.runtime.sendMessage({ type: ... })` has a matching handler in
// background.js's switch statement. This schema enumerates them.

export const MESSAGE_TYPES = [
  "GET_PAGE_CONTEXT",
  "ASK_ZO",
  "TEST_CONNECTION",
  "GET_CONFIG",
  "LIST_MODELS",
  "LIST_PERSONAS",
  "EXECUTE_ACTIONS",
  "NAVIGATE",
  "EXECUTE_CONTENT_SCRIPT",
  "GENERATE_PRESET",
  "SAVE_PAGE",
  "RUN_SKILL",
  "NEW_CONVERSATION",
  "RECREATE_CONTEXT_MENUS",
] as const;

export const MessageType = z.enum(MESSAGE_TYPES);

// A schema that matches any valid message envelope (type + optional payload keys).
// Individual messages carry their own payloads; this validates the discriminator.
export const MessageEnvelope = z.object({
  type: MessageType,
}).passthrough();
