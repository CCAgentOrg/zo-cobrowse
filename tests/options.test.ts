import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const OPTIONS_PATH = resolve(import.meta.dir, "../extension/options.js");

describe("options.js", () => {
  const code = readFileSync(OPTIONS_PATH, "utf-8");

  it("is valid JavaScript", () => {
    expect(() => new Function(code)).not.toThrow();
  });

  it("loads saved config on DOMContentLoaded", () => {
    expect(code).toContain("DOMContentLoaded");
    expect(code).toContain("chrome.storage.sync.get");
  });

  it("saves config on form submit", () => {
    expect(code).toContain("addEventListener");
    expect(code).toContain("chrome.storage.sync.set");
    expect(code).toContain("access-token");
    expect(code).toContain("model");
  });

  it("fetches models from API when token is saved", () => {
    expect(code).toContain("populateModels");
    expect(code).toContain("models/available");
  });

  it("has a test connection button", () => {
    expect(code).toContain("testBtn");
    expect(code).toContain("test-btn");
    expect(code).toContain("fetch");
  });

it("has screenshot toggle in UI", () => {
    expect(code).toContain("enable-screenshots");
    expect(code).toContain("Screenshot");
    expect(code).toContain("enableScreenshots");
  });

  it("shows status messages", () => {
    expect(code).toContain("statusMsg");
    expect(code).toContain("status-message");
  });
});
