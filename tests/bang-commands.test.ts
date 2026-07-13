import { describe, it, expect } from "bun:test";
import { parseBangCommand, BANG_COMMANDS } from "../extension/lib/bang-commands.js";
import { BangCommandResultSchema, type BangCommandResult } from "./schemas/bang-commands.js";

// Helper: parse + validate against the Zod schema. Throws with Zod's
// human-readable error if the shape drifts from the contract.
function parse(raw: string): BangCommandResult {
  const result = parseBangCommand(raw);
  const parsed = BangCommandResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `parseBangCommand(${JSON.stringify(raw)}) returned invalid shape:\n` +
        parsed.error.message
    );
  }
  return parsed.data;
}

describe("parseBangCommand — schema conformance", () => {
  it("returns { handled: false } for non-bang input", () => {
    expect(parse("just a question")).toEqual({ handled: false, kind: "passthrough" });
    expect(parse("")).toEqual({ handled: false, kind: "passthrough" });
    expect(parse(" leading space")).toEqual({ handled: false, kind: "passthrough" });
  });

  it("!help / !commands / !? return an inline reply listing all commands", () => {
    for (const raw of ["!help", "!commands", "!?"]) {
      const r = parse(raw);
      expect(r.handled).toBe(true);
      if ("inlineReply" in r) {
        // Every registered command appears in the help text
        for (const name of Object.keys(BANG_COMMANDS)) {
          expect(r.inlineReply).toContain(`!${name}`);
        }
        expect(r.inlineReply).toContain("!save");
      }
    }
  });

  it("!save returns { isSave: true, savePath }", () => {
    expect(parse("!save")).toEqual({ handled: true, kind: "save", isSave: true, savePath: "" });
    expect(parse("!save my-note.md")).toEqual({
      handled: true,
      kind: "save",
      isSave: true,
      savePath: "my-note.md",
    });
  });

  it("unknown command returns an inline error mentioning !help", () => {
    const r = parse("!bogus");
    expect(r.handled).toBe(true);
    if ("inlineReply" in r) {
      expect(r.inlineReply).toContain("Unknown command");
      expect(r.inlineReply).toContain("!help");
    }
  });

  it("every registered bang command resolves to a query + preset", () => {
    for (const name of Object.keys(BANG_COMMANDS)) {
      const r = parse(`!${name}`);
      expect(r.handled).toBe(true);
      if ("query" in r) {
        expect(typeof r.query).toBe("string");
        expect(r.query.length).toBeGreaterThan(0);
      }
    }
  });

  it("commands accept args and fold them into the query", () => {
    const r = parse("!extract prices");
    expect(r.handled).toBe(true);
    if ("query" in r) expect(r.query).toContain("prices");

    const r2 = parse("!research climate policy");
    expect(r2.handled).toBe(true);
    if ("query" in r2) expect(r2.query).toContain("climate policy");

    const r3 = parse("!skill cc-awareness-video");
    expect(r3.handled).toBe(true);
    if ("query" in r3) expect(r3.query).toContain("cc-awareness-video");
  });

  it("preset field is either null or a known preset name", () => {
    const knownPresets = ["summarize", "scrape", "research", "qa"];
    for (const name of Object.keys(BANG_COMMANDS)) {
      const r = parse(`!${name}`);
      if ("preset" in r) {
        expect(r.preset === null || knownPresets.includes(r.preset)).toBe(true);
      }
    }
  });
});

describe("BANG_COMMANDS — registry integrity", () => {
  it("every command has label + desc + buildQuery function", () => {
    for (const [name, def] of Object.entries(BANG_COMMANDS)) {
      expect(typeof def.label).toBe("string");
      expect(def.label.length).toBeGreaterThan(0);
      expect(typeof def.desc).toBe("string");
      expect(def.desc.length).toBeGreaterThan(0);
      expect(typeof def.buildQuery).toBe("function");
    }
  });

  it("buildQuery never throws or returns empty for no args", () => {
    for (const [name, def] of Object.entries(BANG_COMMANDS)) {
      const q = def.buildQuery("");
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(0);
    }
  });
});
