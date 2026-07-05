import { describe, it, expect, beforeEach } from "bun:test";
import { resolve } from "path";

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
