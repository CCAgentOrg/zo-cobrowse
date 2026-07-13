import { describe, it, expect, beforeEach } from "bun:test";
import { resolve } from "path";
import { readFileSync } from "fs";

// ---- Mock Chrome API ----
const storage: Record<string, any> = {};
(globalThis as any).chrome = {
  storage: {
    sync: {
      get: async (keys: string | string[] | Record<string, any> | null) => {
        if (typeof keys === "string") return { [keys]: storage[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, any> = {};
          for (const k of keys) result[k] = storage[k];
          return result;
        }
        if (keys === null) return { ...storage };
        const result: Record<string, any> = {};
        for (const k of Object.keys(keys)) result[k] = storage[k] ?? (keys as any)[k];
        return result;
      },
      set: async (items: Record<string, any>) => {
        Object.assign(storage, items);
      },
    },
    onChanged: { addListener: () => {} },
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
  action: {
    onClicked: { addListener: () => {} },
  },
  tabs: {
    query: async () => [{ id: 1, url: "https://example.com", title: "Test" }],
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: () => {} },
    onConnect: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
  },
  contextMenus: {
    create: () => {},
    removeAll: (cb) => { if (cb) cb(); },
    onClicked: {
      addListener: () => {},
    },
  },
  commands: {
    onCommand: {
      addListener: () => {},
    },
  },
};

describe("background.js defaults", () => {
  beforeEach(() => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  });

  it("loads without errors", async () => {
    const mod = await import(resolve(import.meta.dir, "../extension/background.js"));
    expect(mod).toBeDefined();
  });

  it("persists and retrieves config values", async () => {
    await chrome.storage.sync.set({ zoToken: "test-token-123" });
    const result = await chrome.storage.sync.get("zoToken");
    expect(result.zoToken).toBe("test-token-123");
  });

  it("merges defaults with stored values", async () => {
    const defaults = {
      zoApiUrl: "https://api.zo.computer/zo/ask",
      zoModel: "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc",
      zoToken: "",
    };
    await chrome.storage.sync.set({ zoToken: "my-token" });
    const result = await chrome.storage.sync.get(defaults);
    expect(result.zoToken).toBe("my-token");
    expect(result.zoApiUrl).toBe("https://api.zo.computer/zo/ask");
    expect(result.zoModel).toBe("byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc");
  });

  it("stores and retrieves complex config objects", async () => {
    const config = {
      zoToken: "tok_abc",
      zoApiUrl: "https://custom.api.com/zo/ask",
      zoModel: "claude-sonnet-4-20250514",
      zoSpaceEndpoint: "https://custom.zo.space",
    };
    await chrome.storage.sync.set(config);
    const result = await chrome.storage.sync.get(Object.keys(config));
    expect(result).toEqual(config);
  });
});

const code = readFileSync(resolve(import.meta.dir, "../extension/background.js"), "utf-8");

describe("background persona routing", () => {
  it("has intent classification keywords", () => {
    expect(code).toContain("LITE_KEYWORDS");
    expect(code).toContain("FULL_KEYWORDS");
    expect(code).toContain("classifyIntent");
    expect(code).toContain("resolvePersona");
  });

  it("classifies lite intents", () => {
    expect(code).toContain("summarize");
    expect(code).toContain("extract");
    expect(code).toContain("tl;dr");
  });

  it("classifies full intents", () => {
    expect(code).toContain("duckdb");
    expect(code).toContain("skill");
    expect(code).toContain("automati");
  });

  it("supports persona routing config", () => {
    expect(code).toContain("zoLitePersonaId");
    expect(code).toContain("zoFullPersonaId");
    expect(code).toContain("personaMode");
  });

  it("reduces context size for lite mode", () => {
    expect(code).toContain("isLite");
    expect(code).toContain("2000");
  });

  it("returns intent in response", () => {
    expect(code).toContain("intent:");
    expect(code).toContain("resolvedIntent");
  });

  it("has context menu creation in onInstalled", () => {
    expect(code).toContain("onInstalled");
    expect(code).toContain("contextMenus.create");
    expect(code).toContain("contextMenus.onClicked");
  });

  it("has context menu handlers for page/selection/link", () => {
    expect(code).toContain("cobrowse-page");
    expect(code).toContain("cobrowse-selection");
    expect(code).toContain("cobrowse-link");
    expect(code).toContain("cobrowse-fill");
  });

  it("has enabledMenus config", () => {
    expect(code).toContain("enabledMenus");
    expect(code).toContain("storage.session.set");
    expect(code).toContain("sidePanel.open");
  });

  it("has commands listener for keyboard shortcuts (#06)", () => {
    expect(code).toContain("chrome.commands.onCommand");
    expect(code).toContain("summarize-page");
    expect(code).toContain("new-chat");
    expect(code).toContain("extract-page");
    expect(code).toContain("pendingZoQuery");
    expect(code).toContain("sidePanel.open");
  });

});
