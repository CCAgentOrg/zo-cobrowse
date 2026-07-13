import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { MESSAGE_TYPES } from "./schemas/messages.js";

const BG_PATH = resolve(import.meta.dir, "../extension/background.js");
const code = readFileSync(BG_PATH, "utf-8");

describe("message protocol contract — background.js ↔ schemas/messages.ts", () => {
  // Extract every `case 'X':` from the message router in background.js.
  const handled = new Set(
    [...code.matchAll(/case ['"]([A-Z_]+)['"]:/g)].map((m) => m[1])
  );

  it("background.js handles every message type declared in the schema", () => {
    const missing = MESSAGE_TYPES.filter((t) => !handled.has(t));
    expect(
      missing,
      `background.js is missing handlers for: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("the schema does not silently drop handlers background.js already implements", () => {
    // If background.js grows a new message type, the schema must grow too —
    // otherwise the contract test above gives a false sense of coverage.
    const undeclared = [...handled].filter((t) => !MESSAGE_TYPES.includes(t));
    expect(
      undeclared,
      `background.js handles undeclared message types (add to schemas/messages.ts): ${undeclared.join(", ")}`
    ).toEqual([]);
  });
});
