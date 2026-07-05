import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const MANIFEST_PATH = resolve(import.meta.dir, "../extension/manifest.json");

describe("manifest.json", () => {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw);

  it("is valid JSON", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("has manifest_version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("has required fields", () => {
    expect(manifest.name).toBeString();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBeString();
  });

  it("has required permissions", () => {
    expect(manifest.permissions).toBeArray();
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.permissions).toContain("activeTab");
  });

  it("has host_permissions", () => {
    expect(manifest.host_permissions).toBeArray();
    expect(manifest.host_permissions.length).toBeGreaterThan(0);
  });

  it("has side_panel path", () => {
    expect(manifest.side_panel).toBeObject();
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
  });

  it("has options_ui page", () => {
    const optionsUi = manifest.options_ui || manifest.options_page;
    expect(optionsUi).toBeTruthy();
  });

  it("has icons in all sizes", () => {
    expect(manifest.icons).toBeObject();
    expect(manifest.icons["16"]).toMatch(/\.png$/);
    expect(manifest.icons["48"]).toMatch(/\.png$/);
    expect(manifest.icons["128"]).toMatch(/\.png$/);
  });
});
