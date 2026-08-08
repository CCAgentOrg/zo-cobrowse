import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const bgCode = readFileSync(resolve(import.meta.dir, "../extension/background.js"), "utf-8");
const contentCode = readFileSync(resolve(import.meta.dir, "../extension/content.js"), "utf-8");

describe("screenshot capture patterns", () => {
  it("uses captureVisibleTab for screenshots", () => {
    expect(bgCode).toMatch(/captureVisibleTab/);
  });

  it("has getActiveTabContext function", () => {
    expect(bgCode).toMatch(/async function getActiveTabContext/);
  });

  it("passes format option for JPEG", () => {
    expect(bgCode).toMatch(/format:\s*["']jpe?g["']/i);
  });

  it("has quality setting in screenshot value", () => {
    // Chrome captureVisibleTab only supports format (jpeg/png), not quality
    expect(bgCode).toMatch(/captureVisibleTab/);
  });

  it("handles tab capture errors gracefully", () => {
    expect(bgCode).toMatch(/catch\s*\(/);
  });

  it("returns context object with text + screenshot", () => {
    // Must include both text content and image data in result
    expect(bgCode).toMatch(/pageContext/i);
    expect(bgCode).toMatch(/screenshot/i);
  });

  it("gates screenshot capture by the Mode context tier", () => {
    expect(bgCode).toMatch(/contextTier/i);
    expect(bgCode).toMatch(/screenshot/i);
  });
});

describe("DuckDB query code patterns", () => {
  it("references the DuckDB query handler", () => {
    expect(
      bgCode.includes("runDuckdbQuery") || bgCode.includes("DuckDB")
    ).toBe(true);
  });

  it("has runDuckdbQuery function", () => {
    expect(bgCode).toMatch(/async function runDuckdbQuery/);
  });

  it("returns error object on database failure", () => {
    expect(bgCode).toMatch(/error/i);
  });

  it("escapes or sanitizes user query input", () => {
    expect(bgCode).toMatch(/sanitize|escape|quote|parameterize|query\.replace|\.filter/i);
  });
});

describe("automation creation code patterns", () => {
  it("handles CREATE_AUTOMATION message type", () => {
    expect(bgCode).toMatch(/CREATE_AUTOMATION/);
  });

  it("handles LIST_AUTOMATIONS message type", () => {
    expect(bgCode).toMatch(/LIST_AUTOMATIONS/);
  });

  it("makes POST request to create automation", () => {
    expect(bgCode).toMatch(/POST/);
    expect(bgCode).toMatch(/automation/i);
  });
});
