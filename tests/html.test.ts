import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const EXT = resolve(import.meta.dir, "../extension");

function readHTML(name: string): string {
  return readFileSync(resolve(EXT, name), "utf-8");
}

describe("sidepanel.html", () => {
  const html = readHTML("sidepanel.html");

  it("has DOCTYPE", () => {
    expect(html).toStartWith("<!DOCTYPE html>");
  });

  it("has required UI elements", () => {
    expect(html).toContain("id=\"messages\"");
    expect(html).toContain("id=\"query-input\"");
    expect(html).toContain("id=\"send-btn\"");
    expect(html).toContain("id=\"status-dot\"");
    expect(html).toContain("id=\"actions-bar\"");
    expect(html).toContain("id=\"page-url\"");
    expect(html).toContain("id=\"new-chat-btn\"");
    expect(html).toContain("id=\"history-btn\"");
    expect(html).toContain("id=\"chat-view\"");
    expect(html).toContain("id=\"history-view\"");
    expect(html).toContain("id=\"history-list\"");
    expect(html).toContain("id=\"back-to-chat-btn\"");
  });

  it("includes CSS and JS", () => {
    expect(html).toContain("styles.css");
    expect(html).toContain("sidepanel.js");
  });
});

describe("options.html", () => {
  const html = readHTML("options.html");

  it("has DOCTYPE", () => {
    expect(html).toStartWith("<!DOCTYPE html>");
  });

  it("has settings form fields", () => {
    expect(html).toContain("id=\"access-token\"");
    expect(html).toContain("id=\"space-endpoint\"");
    expect(html).toContain("id=\"options-theme\"");
    expect(html).toContain("id=\"model\"");
    expect(html).toContain("id=\"model-status\"");
    expect(html).toContain("needs token");
    expect(html).toContain("id=\"settings-form\"");
  });

  it("includes CSS and JS", () => {
    expect(html).toContain("styles.css");
    expect(html).toContain("options.js");
  });
});
