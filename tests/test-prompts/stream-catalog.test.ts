/**
 * stream-catalog.test.ts — validates prompts.json catalog completeness & consistency
 * with the BUILTIN_MODES defined in extension/lib/modes.js.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { BUILTIN_MODES } from "../../extension/lib/modes.js";
import { PromptsCatalog } from "./schema.js";

const CATALOG_PATH = resolve(import.meta.dir, "prompts.json");
const raw = readFileSync(CATALOG_PATH, "utf-8");
const catalog = PromptsCatalog.parse(JSON.parse(raw));

describe("prompts.json catalog", () => {
  it("is a valid PromptsCatalog (Zod schema)", () => {
    // The parse above already validated; this is an explicit assertion
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThanOrEqual(7);
  });

  it("covers every builtin mode", () => {
    const modeIds = new Set(Object.keys(BUILTIN_MODES));
    const covered = new Set(catalog.map((e) => e.mode));
    for (const modeId of modeIds) {
      expect(covered.has(modeId)).toBe(true);
    }
  });

  it("covers both cobrowse intents (action + read-only)", () => {
    const cobrowseEntries = catalog.filter((e) => e.mode === "cobrowse");
    expect(cobrowseEntries.length).toBeGreaterThanOrEqual(2);
    const withJson = cobrowseEntries.filter((e) => e.expectJson === true);
    const withoutJson = cobrowseEntries.filter((e) => e.expectJson === false);
    expect(withJson.length).toBeGreaterThanOrEqual(1);
    expect(withoutJson.length).toBeGreaterThanOrEqual(1);
  });

  it("each entry's tier matches its mode", () => {
    for (const entry of catalog) {
      const mode = BUILTIN_MODES[entry.mode];
      if (!mode) continue; // custom mode not in BUILTIN_MODES — skip
      expect(entry.tier).toBe(mode.contextTier);
    }
  });

  it("each entry's expectJson matches its mode (unless downgraded)", () => {
    for (const entry of catalog) {
      const mode = BUILTIN_MODES[entry.mode];
      if (!mode) continue;
      if (entry.expectShape === "action-envelope-json") {
        expect(entry.expectJson).toBe(true);
        expect(mode.expectJson).toBe(true); // only cobrowse has expectJson:true
      } else {
        // For plain-markdown entries, expectJson can be false (all built-in
        // read-only modes), or true with downgrade (cobrowse-readonly)
        if (mode.expectJson) {
          // cobrowse with read-only intent — downgraded
          expect(entry.id).toMatch(/readonly/i);
        }
      }
    }
  });

  it("each entry has a unique id", () => {
    const ids = catalog.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each entry has a non-empty query", () => {
    for (const entry of catalog) {
      expect(entry.query.length).toBeGreaterThan(0);
    }
  });
});
