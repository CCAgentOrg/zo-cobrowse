import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as vm from "node:vm";

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
describe("sidepanel Mode system", () => {
  it("has a Mode select element in HTML", () => {
    const htmlPath = resolve(import.meta.dir, "../extension/sidepanel.html");
    const html = readFileSync(htmlPath, "utf-8");
    expect(html).toContain('id="mode-select"');
    expect(html).toContain('id="create-mode-btn"');
  });

  it("imports the Mode catalog from lib/modes.js", () => {
    expect(code).toContain("./lib/modes.js");
    expect(code).toContain("BUILTIN_MODES");
    expect(code).toContain("resolveMode");
    expect(code).toContain("DEFAULT_MODE_ID");
  });

  it("has Mode lifecycle functions", () => {
    expect(code).toContain("function loadModes");
    expect(code).toContain("function applyMode");
    expect(code).toContain("function rebuildModeOptions");
    expect(code).toContain("function startModeCreation");
  });

  it("loads the active Mode from storage on init", () => {
    expect(code).toContain("loadConfig");
    expect(code).toContain("zoActiveMode");
    expect(code).toContain("chrome.storage.sync.get");
  });

  it("ships the built-in Modes in the dropdown", () => {
    const htmlPath = resolve(import.meta.dir, "../extension/sidepanel.html");
    const html = readFileSync(htmlPath, "utf-8");
    for (const m of ["cobrowse", "ask", "research", "summarize", "extract", "visual"]) {
      expect(html).toContain(`value="${m}"`);
    }
  });



  it("has save page command (#09)", () => {
    expect(code).toContain("SAVE_PAGE");
    expect(code).toContain("isSave");
    expect(code).toContain("savePath");
  });




  it("has action timeline rendering (#03)", () => {
    expect(code).toContain("renderActionTimeline");
    expect(code).toContain("updateActionCard");
    expect(code).toContain("ACTION_META");
    expect(code).toContain("action-card");
  });

  it("has duckdb query commands (#05)", () => {
    expect(code).toContain("isDuckdb");
    expect(code).toContain("DUCKDB_QUERY");
    expect(code).toContain("addDuckdbResult");
    expect(code).toContain("renderTable");
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
    expect(code).toContain("tempMode");
  });
  it("adds system message on mode change", () => {
    expect(code).toContain("addSystemMessage");
    expect(code).toContain("mode active");
  });
});

describe("sidepanel thinking/reasoning bubble", () => {
  const cssPath = resolve(import.meta.dir, "../extension/styles.css");
  const css = readFileSync(cssPath, "utf-8");

  it("defines the addReasoningBubble helper", () => {
    expect(code).toContain("function addReasoningBubble");
  });

  it("renders a collapsible bubble (toggle + hidden content, collapsed by default)", () => {
    expect(code).toContain("msg-thinking-bubble");
    expect(code).toContain("thinking-toggle");
    expect(code).toContain("thinking-content");
    expect(code).toContain('aria-expanded');
    expect(code).toContain("content.hidden = true");
  });

  it("no-ops on empty reasoning so non-reasoning modes are unaffected", () => {
    expect(code).toMatch(/if \(!text \|\| !text\.trim\(\)\) return/);
  });

  it("renders reasoning through the markdown escaper (text safety)", () => {
    expect(code).toContain("markdownToHtml(text)");
    expect(code).toContain("safeText(reasoning)");
  });

  it("attaches the bubble in the streaming STREAM_DONE path", () => {
    expect(code).toContain("addReasoningBubble(streamSession.msgEl, msg.reasoning)");
  });

  it("persists reasoning with the assistant message (streaming write path)", () => {
    expect(code).toContain("reasoning: reasoningVal");
    expect(code).toContain("safeText(msg.reasoning) || undefined");
  });

  it("re-renders reasoning bubbles from history for assistant messages", () => {
    expect(code).toContain("if (msg.role === 'assistant' && msg.reasoning) addReasoningBubble(el, msg.reasoning)");
  });

  it("styles the bubble, toggle, and content", () => {
    expect(css).toContain(".msg-thinking-bubble");
    expect(css).toContain(".thinking-toggle");
    expect(css).toContain(".thinking-content");
    expect(css).toContain(".thinking-caret");
    expect(css).toContain('.thinking-toggle[aria-expanded="true"] .thinking-caret');
    expect(css).toContain(".thinking-content[hidden]");
  });

  it("stacks the bubble above the body (flex-wrap + full-width bubble)", () => {
    // Regression guard: the bubble is inserted INSIDE a .msg (display:flex row),
    // so it must take the full row to wrap onto its own line above .msg-body.
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toMatch(/\.msg-thinking-bubble\s*\{[^}]*flex:\s*1 0 100%/);
  });
});

// ── Real DOM test: extract addReasoningBubble + deps from source via vm and
// drive it against a minimal hand-rolled DOM stub. Source-containment tests
// above only grep strings; this one proves the bubble actually renders.
describe("addReasoningBubble DOM behavior", () => {
  // Minimal DOM node stub covering the operations addReasoningBubble uses.
  class El {
    tag: string;
    children: El[] = [];
    parent: El | null = null;
    attrs: Record<string, string> = {};
    classes: string[] = [];
    _hidden = false;
    text = "";
    innerHTML = "";
    listeners: Record<string, Function> = {};
    constructor(tag: string) { this.tag = tag; }
    set className(v: string) { this.classes = v ? v.split(/\s+/) : []; }
    get className() { return this.classes.join(" "); }
    set textContent(v: string) { this.text = String(v ?? ""); this.innerHTML = ""; }
    get textContent() { return this.text; }
    set hidden(v: boolean) { this._hidden = !!v; }
    get hidden() { return this._hidden; }
    setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
    getAttribute(k: string) { return this.attrs[k] ?? null; }
    appendChild(c: El) { c.parent = this; this.children.push(c); return c; }
    insertBefore(c: El, ref: El | null) {
      c.parent = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx === -1) this.children.push(c);
      else this.children.splice(idx, 0, c);
      return c;
    }
    addEventListener(ev: string, fn: Function) { this.listeners[ev] = fn; }
    querySelector(sel: string): El | null {
      const cls = sel.startsWith(".") ? sel.slice(1).split(".")[0] : null;
      const tag = sel.startsWith(".") ? null : sel;
      return this._find(cls, tag);
    }
    _find(cls: string | null, tag: string | null): El | null {
      for (const c of this.children) {
        if ((!cls || c.classes.includes(cls)) && (!tag || c.tag === tag)) return c;
        const found = c._find(cls, tag);
        if (found) return found;
      }
      return null;
    }
    querySelectorAll(sel: string): El[] {
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      const out: El[] = [];
      const walk = (n: El) => {
        for (const c of n.children) {
          if (!cls || c.classes.includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    get firstChild() { return this.children[0] ?? null; }
    click() { if (this.listeners.click) (this.listeners.click as () => void)(); }
  }

  // Brace-match a function body in the source by name.
  function extractFn(name: string): string {
    const start = code.indexOf("function " + name + "(");
    if (start === -1) throw new Error("fn not found: " + name);
    let depth = 0, started = false, end = start;
    for (let i = start; i < code.length; i++) {
      if (code[i] === "{") { depth++; started = true; }
      else if (code[i] === "}") { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    return code.slice(start, end);
  }

  function loadAddReasoningBubble(): (parent: El, reasoning: any) => void {
    const sandbox: any = {};
    vm.createContext(sandbox);
    // Provide document.createElement to the stub.
    sandbox.document = { createElement: (t: string) => new El(t) };
    vm.runInContext(
      extractFn("safeText") + "\n" +
      extractFn("escapeHtml") + "\n" +
      extractFn("markdownToHtml") + "\n" +
      extractFn("addReasoningBubble"),
      sandbox,
    );
    if (typeof sandbox.addReasoningBubble !== "function") {
      throw new Error("failed to load addReasoningBubble");
    }
    return sandbox.addReasoningBubble;
  }

  it("inserts a collapsed bubble ABOVE .msg-body and reveals it on toggle", () => {
    const addReasoningBubble = loadAddReasoningBubble();
    // Build the same shape addMessageDOM produces: div.msg.msg-assistant > div.msg-body
    const msg = new El("div");
    msg.className = "msg msg-assistant";
    const body = new El("div");
    body.className = "msg-body";
    msg.appendChild(body);

    const reasoning = "The page is a basic documentation landing page.";
    addReasoningBubble(msg, reasoning);

    // Bubble inserted as a child, BEFORE the body
    const bubble = msg.querySelector(".msg-thinking-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble!.parent).toBe(msg);
    expect(msg.children[0]).toBe(bubble);
    expect(msg.children[1]).toBe(body);

    // Toggle header with char count, aria-expanded=false (collapsed)
    const toggle = bubble!.querySelector(".thinking-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(toggle!.querySelector(".thinking-label")!.textContent)
      .toContain(String(reasoning.length));

    // Content exists, hidden by default, carries the (escaped) reasoning
    const content = bubble!.querySelector(".thinking-content");
    expect(content).not.toBeNull();
    expect(content!.hidden).toBe(true);
    expect(content!.innerHTML).toContain("documentation landing page");

    // Click → expands: aria-expanded flips, content unhidden
    toggle!.click();
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(content!.hidden).toBe(false);
    // Click again → collapses
    toggle!.click();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(content!.hidden).toBe(true);
  });

  it("no-ops on empty/whitespace reasoning (no bubble added)", () => {
    const addReasoningBubble = loadAddReasoningBubble();
    const msg = new El("div");
    msg.className = "msg msg-assistant";
    msg.appendChild(Object.assign(new El("div"), { className: "msg-body" }));
    const before = msg.children.length;

    addReasoningBubble(msg, "");
    addReasoningBubble(msg, "   ");
    addReasoningBubble(msg, null);
    addReasoningBubble(msg, undefined);

    expect(msg.children.length).toBe(before); // unchanged
    expect(msg.querySelector(".msg-thinking-bubble")).toBeNull();
  });

  it("no-ops when parentMsgEl is null/falsy", () => {
    const addReasoningBubble = loadAddReasoningBubble();
    expect(() => addReasoningBubble(null, "reasoning")).not.toThrow();
    expect(() => addReasoningBubble(undefined, "reasoning")).not.toThrow();
  });

  it("does not duplicate the bubble on a second call", () => {
    const addReasoningBubble = loadAddReasoningBubble();
    const msg = new El("div");
    msg.className = "msg msg-assistant";
    msg.appendChild(Object.assign(new El("div"), { className: "msg-body" }));

    addReasoningBubble(msg, "reason one");
    addReasoningBubble(msg, "reason two");

    const bubbles = msg.querySelectorAll(".msg-thinking-bubble");
    expect(bubbles.length).toBe(1);
    // First reasoning wins (guard short-circuits the second call)
    expect(bubbles[0].querySelector(".thinking-content")!.innerHTML).toContain("reason one");
  });
});
