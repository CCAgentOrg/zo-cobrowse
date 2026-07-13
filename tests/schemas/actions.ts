import { z } from "zod";

// The action protocol — the contract between Zo and the extension.
// Zo returns a JSON array of actions; the extension executes them in the DOM.
// This schema is the single source of truth for valid action shapes.

export const NavigateAction = z.object({
  type: z.literal("navigate"),
  url: z.string().url(),
});

export const ClickAction = z.object({
  type: z.literal("click"),
  selector: z.string().min(1),
});

export const FillAction = z.object({
  type: z.literal("fill"),
  selector: z.string().min(1),
  value: z.string(),
});

export const ExtractAction = z.object({
  type: z.literal("extract"),
  selector: z.string(),
  attribute: z.string().optional(),
});

export const ScrollAction = z.object({
  type: z.literal("scroll"),
  direction: z.enum(["up", "down"]).optional(),
  selector: z.string().optional(),
  amount: z.number().optional(),
});

export const WaitAction = z.object({
  type: z.literal("wait"),
  ms: z.number().int().nonnegative().optional(),
});

export const DoneAction = z.object({
  type: z.literal("done"),
  response: z.string(),
});

export const Action = z.discriminatedUnion("type", [
  NavigateAction,
  ClickAction,
  FillAction,
  ExtractAction,
  ScrollAction,
  WaitAction,
  DoneAction,
]);

export const ActionArray = z.array(Action);

export type Action = z.infer<typeof Action>;

// The set of valid action types — used to assert the extension handles all of them.
export const ACTION_TYPES = [
  "navigate",
  "click",
  "fill",
  "extract",
  "scroll",
  "wait",
  "done",
] as const;
