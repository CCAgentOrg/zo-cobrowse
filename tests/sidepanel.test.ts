import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as vm from "node:vm";
import { normalizeActions } from "../extension/lib/modes.js";

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

  it("renders the timeline as an inline run block + groups repeats + tracks duration (Gaps 1/2/4)", () => {
    // Inline "⚡ Worked N steps · duration" run block in the chat stream.
    expect(code).toContain("function groupActions");
    expect(code).toContain("msg-action-run");
    expect(code).toContain("action-run-header");
    expect(code).toContain("⚡ Worked");
    expect(code).toContain("function formatDuration");
    // Duration is captured at run start/end.
    expect(code).toMatch(/runStartTime = Date\.now\(\)/);
    expect(code).toMatch(/Date\.now\(\) - runStartTime/);
    // The old duplicate inline ".msg-action" message per step is gone.
    expect(code).not.toContain("addMessage('action',");
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

  it("shows a one-line summary in the collapsed header (Gap 3, matches zo.computer)", () => {
    // The label is now "💭 Thought" plus a reasoningSummary() preview, not a
    // bare char count.
    expect(code).toContain("function reasoningSummary");
    expect(code).toContain("'💭 Thought'");
    expect(code).toContain("thinking-summary");
    expect(css).toContain(".thinking-summary");
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
    // Render loops heal each assistant msg (key-first blob repair) into `m`,
    // then attach the reasoning bubble from the healed message.
    expect(code).toContain("if (m.role === 'assistant' && m.reasoning) addReasoningBubble(el, m.reasoning)");
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

describe("sidepanel non-streaming ASK_ZO path normalizes key-first actions", () => {
  // Regression guard for the raw-JSON-in-chat bug: the non-streaming ASK_ZO
  // response handler must run actions through normalizeActions() (key-first →
  // type-first) so the done.response is found and reasoning bubbles render,
  // instead of the whole {reasoning, actions} blob leaking into the chat.
  it("imports normalizeActions from lib/modes.js", () => {
    expect(code).toMatch(/import\s*\{[^}]*\bnormalizeActions\b[^}]*\}\s*from\s*['"]\.\/lib\/modes\.js['"]/);
  });

  it("applies normalizeActions in both parse branches (object + JSON-string output)", () => {
    // Two call sites: the object branch and the string/JSON.parse branch.
    const matches = code.match(/normalizeActions\(/g) || [];
    // At least two usages in the response handler (plus the import, which is
    // not a call). We assert >=2 call sites to cover both branches.
    expect(matches.length).toBeGreaterThanOrEqual(2);
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
      extractFn("reasoningSummary") + "\n" +
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

    // Toggle header: label is now "💭 Thought", with a summary preview line
    // and a separate char-count meta span (Gap 3, matches zo.computer).
    const toggle = bubble!.querySelector(".thinking-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(toggle!.querySelector(".thinking-label")!.textContent).toContain("Thought");
    // The one-line summary preview reflects the reasoning content.
    const summary = toggle!.querySelector(".thinking-summary");
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain("documentation landing page");
    // Char count moved to a dedicated meta span.
    const meta = toggle!.querySelector(".thinking-meta");
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain(String(reasoning.length));

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

// ── healAssistantMessage: fixes persisted history saved before the
// action-normalization fix (where the raw {reasoning, actions} JSON blob was
// stored as msg.text and re-rendered as raw JSON on every conversation load).
describe("healAssistantMessage — persisted-history repair", () => {
  function braceEnd(src: string, start: number): number {
    let depth = 0, started = false;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") { depth++; started = true; }
      else if (src[i] === "}") { depth--; if (started && depth === 0) return i + 1; }
    }
    return start;
  }
  function loadHealer() {
    const safeStart = code.indexOf("function safeText(");
    const safeEnd = braceEnd(code, safeStart);
    const healStart = code.indexOf("function healAssistantMessage(");
    const healEnd = braceEnd(code, healStart);
    const sandbox: any = { normalizeActions };
    vm.createContext(sandbox);
    vm.runInContext(code.slice(safeStart, safeEnd) + "\n" + code.slice(healStart, healEnd), sandbox);
    if (typeof sandbox.healAssistantMessage !== "function") {
      throw new Error("failed to load healAssistantMessage");
    }
    return sandbox.healAssistantMessage as (msg: any) => any;
  }

  it("heals a persisted key-first {reasoning, actions} blob into text + reasoning", () => {
    const heal = loadHealer();
    // Exactly the shape that leaked into history before the fix.
    const leaked = {
      role: 'assistant',
      text: JSON.stringify({
        reasoning: "The page failed to load. No content to extract.",
        actions: [{ done: { response: "The page refused the connection." } }],
      }),
      timestamp: 1,
    };
    const healed = heal(leaked);
    expect(healed.text).toBe("The page refused the connection.");
    expect(healed.reasoning).toBe("The page failed to load. No content to extract.");
    expect(healed.healed).toBe(true);
    // The raw JSON must be gone from the rendered text.
    expect(healed.text).not.toContain('"reasoning"');
    expect(healed.text).not.toContain('"actions"');
  });

  it("passes a normal assistant message's text/reasoning through unchanged", () => {
    const heal = loadHealer();
    const normal = { role: 'assistant', text: '## Summary\n\nNo links here.', reasoning: 'thoughts', timestamp: 2 };
    const out = heal(normal);
    // Non-JSON text is returned as-is (text + reasoning preserved, not repaired).
    expect(out.text).toBe(normal.text);
    expect(out.reasoning).toBe(normal.reasoning);
  });

  it("preserves existing reasoning when healing (doesn't clobber)", () => {
    const heal = loadHealer();
    const msg = {
      role: 'assistant',
      text: JSON.stringify({ reasoning: 'parsed-out reasoning', actions: [{ done: { response: 'ans' } }] }),
      reasoning: 'already-stored reasoning',
      timestamp: 3,
    };
    const out = heal(msg);
    expect(out.reasoning).toBe('already-stored reasoning');
  });

  it("does not treat non-JSON text or unrelated JSON as a leaked payload", () => {
    const heal = loadHealer();
    const plain = { role: 'assistant', text: 'Just a normal answer.', timestamp: 4 };
    expect(heal(plain).text).toBe('Just a normal answer.');
    // JSON object without reasoning/actions signature → not a leaked payload.
    const otherJson = { role: 'assistant', text: JSON.stringify({ foo: 1, bar: 2 }), timestamp: 5 };
    expect(heal(otherJson).text).toBe(JSON.stringify({ foo: 1, bar: 2 }));
  });

  it("returns non-assistant messages untouched", () => {
    const heal = loadHealer();
    const user = { role: 'user', text: JSON.stringify({ reasoning: 'x', actions: [] }), timestamp: 6 };
    expect(heal(user)).toBe(user);
    expect(heal(null)).toBe(null);
  });

  it("the render-from-history loops route assistant messages through healAssistantMessage", () => {
    // Source guard: both history render loops must call healAssistantMessage,
    // otherwise old conversations still render raw JSON.
    const callSites = (code.match(/healAssistantMessage\(msg\)/g) || []).length;
    expect(callSites).toBeGreaterThanOrEqual(2);
  });
});

// ── renderActionTimeline DOM behavior: inline "⚡ Worked N steps" run block
// (Gaps 1/2/4 — matches zo.computer). Exercises the real function extracted
// from sidepanel.js against a richer DOM stub that supports getElementById +
// dataset, which renderActionTimeline uses.
describe("renderActionTimeline DOM behavior — inline run block", () => {
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

  // DOM stub with dataset + getElementById + classList-ish class arrays.
  class RunEl {
    tag: string;
    id = "";
    children: RunEl[] = [];
    parent: RunEl | null = null;
    attrs: Record<string, string> = {};
    classes: string[] = [];
    _hidden = false;
    text = "";
    innerHTML = "";
    dataset: Record<string, string> = {};
    listeners: Record<string, Function> = {};
    constructor(tag: string) { this.tag = tag; }
    set className(v: string) { this.classes = v ? v.split(/\s+/).filter(Boolean) : []; }
    get className() { return this.classes.join(" "); }
    set textContent(v: string) { this.text = String(v ?? ""); this.innerHTML = ""; }
    get textContent() { return this.text; }
    set hidden(v: boolean) { this._hidden = !!v; }
    get hidden() { return this._hidden; }
    setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
    getAttribute(k: string) { return this.attrs[k] ?? null; }
    appendChild(c: RunEl) { c.parent = this; this.children.push(c); return c; }
    insertBefore(c: RunEl, ref: RunEl | null) {
      c.parent = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx === -1) this.children.push(c); else this.children.splice(idx, 0, c);
      return c;
    }
    addEventListener(ev: string, fn: Function) { this.listeners[ev] = fn; }
    // Minimal classList shim (renderActionTimeline calls actionsBar.classList.remove).
    get classList() {
      const self = this;
      return {
        add(c: string) { if (!self.classes.includes(c)) self.classes.push(c); },
        remove(c: string) { self.classes = self.classes.filter((x) => x !== c); },
        contains(c: string) { return self.classes.includes(c); },
        toggle(c: string, force?: boolean) {
          const has = self.classes.includes(c);
          const next = force === undefined ? !has : force;
          if (next && !has) self.classes.push(c);
          if (!next && has) self.classes = self.classes.filter((x) => x !== c);
          return next;
        },
      };
    }
    querySelector(sel: string): RunEl | null {
      const cls = sel.startsWith(".") ? sel.slice(1).split(".")[0] : null;
      return this._find(cls);
    }
    _find(cls: string | null): RunEl | null {
      for (const c of this.children) {
        if (!cls || c.classes.includes(cls)) return c;
        const found = c._find(cls);
        if (found) return found;
      }
      return null;
    }
    querySelectorAll(sel: string): RunEl[] {
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      const out: RunEl[] = [];
      const walk = (n: RunEl) => {
        for (const c of n.children) {
          if (!cls || c.classes.includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    click() { if (this.listeners.click) (this.listeners.click as () => void)(); }
  }

  // Extract the `const ACTION_META = {...}` block (ends at its closing `};`).
  function extractConst(name: string): string {
    const start = code.indexOf("const " + name + " =");
    if (start === -1) throw new Error("const not found: " + name);
    let depth = 0, started = false, end = start;
    for (let i = code.indexOf("{", start); i < code.length; i++) {
      if (code[i] === "{") { depth++; started = true; }
      else if (code[i] === "}") { depth--; if (started && depth === 0) { end = i + 2; break; } } // include trailing `;\n`
    }
    return code.slice(start, end);
  }

  // Build a sandbox with the DOM stubs + ACTION_META + the timeline helpers,
  // run renderActionTimeline, and return the msgsEl/actionsBar for assertions.
  function renderTimeline(pending: any[]) {
    const msgsEl = new RunEl("div");
    const actionsBar = new RunEl("div");
    const sandbox: any = {
      document: { createElement: (t: string) => new RunEl(t), getElementById: () => null },
      pendingActions: pending,
      actionsBar,
      msgsEl,
    };
    vm.createContext(sandbox);
    vm.runInContext(
      extractConst("ACTION_META") + "\n" +
      extractFn("actionDetail") + "\n" + extractFn("actionKey") + "\n" +
      extractFn("groupActions") + "\n" + extractFn("formatDuration") + "\n" +
      extractFn("renderActionTimeline"),
      sandbox,
    );
    sandbox.renderActionTimeline();
    return { msgsEl, actionsBar };
  }

  function findRun(msgsEl: RunEl): RunEl {
    const run = [...msgsEl.children].find((c) => c.classes.includes("msg-action-run"));
    if (!run) throw new Error("no .msg-action-run rendered");
    return run;
  }

  it("renders an inline .msg-action-run in the chat stream (not the bar)", () => {
    const { msgsEl, actionsBar } = renderTimeline([
      { type: "click", selector: "#a" },
      { type: "done", response: "ok" },
    ]);
    expect(() => findRun(msgsEl)).not.toThrow();
    const barHasRun = [...actionsBar.children].some((c) => c.classes.includes("msg-action-run"));
    expect(barHasRun).toBe(false);
  });

  it("the run header is collapsed by default (aria-expanded=false, body hidden)", () => {
    const { msgsEl } = renderTimeline([{ type: "click", selector: "#x" }]);
    const run = findRun(msgsEl);
    const header = run.children.find((c) => c.classes.includes("action-run-header"))!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    const body = run.children.find((c) => c.classes.includes("action-run-body"))!;
    expect(body.hidden).toBe(true);
  });

  it("expanding the header reveals the body", () => {
    const { msgsEl } = renderTimeline([{ type: "click", selector: "#x" }]);
    const run = findRun(msgsEl);
    const header = run.children.find((c) => c.classes.includes("action-run-header"))! as RunEl;
    const body = run.children.find((c) => c.classes.includes("action-run-body"))!;
    header.click();
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
  });

  it("groups consecutive identical actions into one card with a count badge", () => {
    const { msgsEl } = renderTimeline([
      { type: "click", selector: "#go" },
      { type: "click", selector: "#go" },
      { type: "click", selector: "#go" },
      { type: "done", response: "ok" },
    ]);
    const cards = findRun(msgsEl).querySelectorAll(".action-card");
    // 3 identical clicks collapse to 1 card + 1 done card = 2 cards total.
    expect(cards.length).toBe(2);
    // The stub's innerHTML setter keeps the markup as a string (no parsed
    // children), so assert on the innerHTML content rather than querySelector.
    expect(cards[0].innerHTML, "first group has a × 3 count badge").toContain("× 3");
    expect(cards[1].innerHTML, "single done has no count badge").not.toContain("action-count");
  });
});
