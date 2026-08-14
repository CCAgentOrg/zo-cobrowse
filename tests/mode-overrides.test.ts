import { describe, it, expect } from "bun:test";
import {
  BUILTIN_MODES,
  resolveMode,
  mergeOverride,
  EDITABLE_MODE_FIELDS,
} from "../extension/lib/modes.js";
import { ModeSchema, OverrideSchema } from "./schemas/modes.js";

function expectValidMode(m: unknown) {
  const p = ModeSchema.safeParse(m);
  if (!p.success) throw new Error(`Mode failed schema:\n${JSON.stringify(m, null, 2)}\n${p.error.message}`);
  return p.data;
}

describe("mergeOverride", () => {
  it("returns the base unchanged when no override is given", () => {
    expect(mergeOverride(BUILTIN_MODES.ask)).toBe(BUILTIN_MODES.ask);
    expect(mergeOverride(BUILTIN_MODES.ask, null)).toBe(BUILTIN_MODES.ask);
    expect(mergeOverride(BUILTIN_MODES.ask, {})).toEqual(BUILTIN_MODES.ask);
  });

  it("overrides only the editable knobs supplied", () => {
    const merged = mergeOverride(BUILTIN_MODES.ask, { textBudget: 4000 });
    expect(merged.textBudget).toBe(4000);
    // Untouched knobs retain the base value.
    expect(merged.systemPrompt).toBe(BUILTIN_MODES.ask.systemPrompt);
    expect(merged.contextTier).toBe(BUILTIN_MODES.ask.contextTier);
  });

  it("never takes identity fields from the override (built-in stays a built-in)", () => {
    // An override trying to rename/rebrand or de-builtin a mode is ignored for
    // those fields — Reset is just "delete the override entry".
    const merged = mergeOverride(BUILTIN_MODES.ask, {
      id: 'evil', name: 'Hijacked', icon: 'x', builtin: false, systemPrompt: 'mine',
    });
    expect(merged.id).toBe('ask');
    expect(merged.name).toBe(BUILTIN_MODES.ask.name);
    expect(merged.icon).toBe(BUILTIN_MODES.ask.icon);
    expect(merged.builtin).toBe(true);
    expect(merged.systemPrompt).toBe('mine'); // editable knob applied
  });

  it("does NOT mutate the underlying BUILTIN_MODES object", () => {
    const before = { ...BUILTIN_MODES.ask };
    mergeOverride(BUILTIN_MODES.ask, { textBudget: 9999, systemPrompt: 'temp' });
    expect(BUILTIN_MODES.ask).toEqual(before); // referentially + value unchanged
  });

  it("produces a schema-valid Mode", () => {
    expectValidMode(mergeOverride(BUILTIN_MODES.cobrowse, { contextTier: 1, textBudget: 1500 }));
  });
});

describe("resolveMode — 3-arg override application", () => {
  it("applies overrides to a built-in id", () => {
    const m = resolveMode('ask', {}, { ask: { textBudget: 3000 } });
    expect(m.textBudget).toBe(3000);
    expect(m.systemPrompt).toBe(BUILTIN_MODES.ask.systemPrompt);
  });

  it("customModes still win over built-ins + overrides (custom edited directly)", () => {
    const custom = { mymode: { id: 'mymode', name: 'Mine', icon: '✨', systemPrompt: 's', instructions: 'i', contextTier: 1, textBudget: 1000, expectJson: false, builtin: false } };
    const m = resolveMode('mymode', custom, { mymode: { textBudget: 9999 } });
    expect(m.textBudget).toBe(1000); // override ignored for custom modes
    expect(m.builtin).toBe(false);
  });

  it("overrides apply to the default fallback (cobrowse) too", () => {
    const m = resolveMode('unknown-id', {}, { cobrowse: { textBudget: 7000 } });
    expect(m.id).toBe('cobrowse');
    expect(m.textBudget).toBe(7000);
  });

  it("2-arg callers keep working (overrides default to {})", () => {
    expect(resolveMode('ask', {}).textBudget).toBe(BUILTIN_MODES.ask.textBudget);
    expect(resolveMode('ask', {}, undefined).textBudget).toBe(BUILTIN_MODES.ask.textBudget);
  });

  it("every resolved built-in (with overrides) validates against ModeSchema", () => {
    const overrides = {
      cobrowse: { contextTier: 1, textBudget: 5000 },
      ask: { systemPrompt: 'You are a focused assistant.' },
      research: { expectJson: true }, // editable, even if unusual
    };
    for (const id of Object.keys(BUILTIN_MODES)) {
      expectValidMode(resolveMode(id, {}, overrides));
    }
  });
});

describe("EDITABLE_MODE_FIELDS", () => {
  it("is exactly the 5 tunable knobs", () => {
    expect([...EDITABLE_MODE_FIELDS].sort()).toEqual(
      ['contextTier', 'expectJson', 'instructions', 'systemPrompt', 'textBudget'],
    );
  });

  it("OverrideSchema accepts a sparse subset of those fields", () => {
    expect(OverrideSchema.safeParse({ textBudget: 1234 }).success).toBe(true);
    expect(OverrideSchema.safeParse({ contextTier: 9 }).success).toBe(false); // out of range
  });
});
