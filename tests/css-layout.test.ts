import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const EXT = resolve(import.meta.dir, "../extension");
const css = readFileSync(resolve(EXT, "styles.css"), "utf-8");

/**
 * Assert that a CSS selector's rule block contains a given declaration.
 * Matches the selector (with its brace-delimited block) anywhere in the file.
 */
function ruleBlock(selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`selector not found: ${selector}`);
  const braceStart = css.indexOf("{", idx);
  const braceEnd = css.indexOf("}", braceStart);
  if (braceStart === -1 || braceEnd === -1) {
    throw new Error(`could not isolate rule block for: ${selector}`);
  }
  return css.slice(braceStart, braceEnd);
}

describe("sticky top region layout", () => {
  it("the shell is a flex column that owns the full viewport height", () => {
    const block = ruleBlock(".shell");
    expect(block).toContain("display: flex");
    expect(block).toContain("flex-direction: column");
    expect(block).toContain("height: 100%");
  });

  it("top-region bars do not shrink (they stay pinned above the scroller)", () => {
    for (const sel of [".header", ".page-bar", ".controls-bar", ".chips-wrap"]) {
      const block = ruleBlock(sel);
      expect(block).toContain("flex-shrink: 0");
    }
  });

  it("#chat-view fills remaining space and allows its children to scroll (not height:100%)", () => {
    const block = ruleBlock("#chat-view");
    // The fix: flex item that takes the leftover space, with min-height:0 so
    // #messages can scroll instead of growing the shell past the viewport.
    expect(block).toContain("flex: 1");
    expect(block).toContain("min-height: 0");
    // The old buggy rule must not come back — it made #chat-view as tall as
    // the entire shell, causing the whole page to scroll and the top region
    // to scroll out of view.
    expect(block).not.toContain("height: 100%");
  });

  it("#messages is the actual scroll container (overflow-y: auto, flex:1)", () => {
    const block = ruleBlock("#messages");
    expect(block).toContain("overflow-y: auto");
    expect(block).toContain("flex: 1");
  });

  it("the body does not itself scroll (overflow: hidden), so only #messages scrolls", () => {
    // html, body share a rule — find the combined block
    const idx = css.indexOf("html, body");
    const braceStart = css.indexOf("{", idx);
    const braceEnd = css.indexOf("}", braceStart);
    const block = css.slice(braceStart, braceEnd);
    expect(block).toContain("overflow: hidden");
  });
});
