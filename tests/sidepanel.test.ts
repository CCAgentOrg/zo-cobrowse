import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SIDEPANEL_PATH = resolve(import.meta.dir, "../extension/sidepanel.js");
const code = readFileSync(SIDEPANEL_PATH, "utf-8");

describe("sidepanel.js", () => {
  it("is valid JavaScript (ESM module)", () => {
    // sidepanel.js is now an ES module (uses import). Validate via Bun's transpiler,
    // which accepts import/export and throws on syntax errors.
    expect(() => new Bun.Transpiler().transformSync(code)).not.toThrow();
  });

  it("has history persistence (MAX_HISTORY, loadConversations, saveConversations)", () => {
    expect(code).toContain("MAX_HISTORY");
    expect(code).toContain("loadConversations");
    expect(code).toContain("saveConversations");
    expect(code).toContain("STORAGE_CONVERSATIONS_KEY");
    expect(code).toContain("chrome.storage.local");
  });

  it("has new chat button and startNewConversation", () => {
    expect(code).toContain("newChatBtn");
    expect(code).toContain("startNewConversation");
    expect(code).toContain("NEW_CONVERSATION");
  });

  it("restores conversations on init", () => {
    expect(code).toContain("loadConversations()");
    expect(code).toContain("migrateOldFormat()");
    expect(code).toContain("fetchModelsAndPersonas()");
  });
});

describe("sidepanel model/persona selectors", () => {
  it("has model-select and persona-select elements in HTML", () => {
    const htmlPath = resolve(import.meta.dir, "../extension/sidepanel.html");
    const html = readFileSync(htmlPath, "utf-8");
    expect(html).toContain('id="model-select"');
    expect(html).toContain('id="persona-select"');
  });

  it("fetches models and personas from background", () => {
    expect(code).toContain('LIST_MODELS');
    expect(code).toContain('LIST_PERSONAS');
    expect(code).toContain('config.selectedModel');
    expect(code).toContain('config.selectedPersona');
  });

  it("passes modelName and personaId in ASK_ZO", () => {
    expect(code).toContain('modelName:');
    expect(code).toContain('personaId:');
  });

  it("persists selections to chrome.storage.sync", () => {
    expect(code).toContain('zoModel');
    expect(code).toContain('zoPersonaId');
    expect(code).toContain('chrome.storage.sync');
  });

  it("maps model_name/label from API response", () => {
    expect(code).toContain('m.model_name');
    expect(code).toContain('m.label');
  });
});

describe("sidepanel history view", () => {
  it("has history button and view elements in HTML", () => {
    const htmlPath = resolve(import.meta.dir, "../extension/sidepanel.html");
    const html = readFileSync(htmlPath, "utf-8");
    expect(html).toContain('id="history-btn"');
    expect(html).toContain('id="chat-view"');
    expect(html).toContain('id="history-view"');
    expect(html).toContain('id="history-list"');
    expect(html).toContain('id="back-to-chat-btn"');
  });

  it("has multi-conversation storage functions", () => {
    expect(code).toContain("switchToConversation");
    expect(code).toContain("deleteConversation");
    expect(code).toContain("renderHistoryView");
    expect(code).toContain("listConversationSummaries");
    expect(code).toContain("createNewConversation");
    expect(code).toContain("migrateOldFormat");
    expect(code).toContain("OLD_STORAGE_KEY");
  });

  it("has conversation grouping by date", () => {
    expect(code).toContain("groupByDate");
    expect(code).toContain("formatTime");
    expect(code).toContain("'Today'");
    expect(code).toContain("'Yesterday'");
  });
});
describe("sidepanel persona routing", () => {
  it("has routing badge element in HTML", () => {
    const htmlPath = resolve(import.meta.dir, "../extension/sidepanel.html");
    const html = readFileSync(htmlPath, "utf-8");
    expect(html).toContain('id="routing-badge"');
  });

  it("has persona routing functions", () => {
    expect(code).toContain("updateRoutingBadge");
    expect(code).toContain("cyclePersonaMode");
    expect(code).toContain("personaMode");
    expect(code).toContain("MODE_LABELS");
    expect(code).toContain("MODE_CYCLE");
  });

  it("loads personaMode from storage on init", () => {
    expect(code).toContain("loadConfig");
    expect(code).toContain("personaMode");
    expect(code).toContain("chrome.storage.sync.get");
  });

  it("displays mode labels", () => {
    expect(code).toContain("◐ Auto");
    expect(code).toContain("☾ Lite");
    expect(code).toContain("⚡ Full");
  });



  it("has save page command (#09)", () => {
    expect(code).toContain("SAVE_PAGE");
    expect(code).toContain("isSave");
    expect(code).toContain("savePath");
  });


  it("has automation command (#08)", () => {
    expect(code).toContain("isAuto");
    expect(code).toContain("CREATE_AUTOMATION");
  });

  it("imports and dispatches bang commands (#07)", () => {
    // Logic now lives in extension/lib/bang-commands.js (unit-tested separately);
    // sidepanel.js imports it and dispatches via parseBangCommand in both sendQuery paths.
    expect(code).toContain("./lib/bang-commands.js");
    expect(code).toContain("parseBangCommand");
    expect(code).toContain("effectiveQuery");
    expect(code).toContain("tempPreset");
  });
  it("adds system message on mode change", () => {
    expect(code).toContain("addSystemMessage");
    expect(code).toContain("Lite mode");
    expect(code).toContain("Full mode");
    expect(code).toContain("Auto mode");
  });
});
