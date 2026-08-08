// Post a message to a streaming port, tolerating disconnects.
// Marks the port dead on failure and returns false so callers can stop
// retrying instead of throwing "disconnected port object" up the stack.
function safePost(port, msg) {
  if (!port || port._dead) return false;
  try {
    port.postMessage(msg);
    return true;
  } catch {
    port._dead = true;
    return false;
  }
}

// True when an error is transient enough to justify a stream retry.
// Non-retriable: missing token (config), auth (401/403), bad request (400),
// missing-content-type, plain text parse errors.
function isRetriableStreamError(err) {
  const m = safeText(err && err.message).toLowerCase();
  if (!m) return true; // unknown — give it one retry
  if (m.includes('token') || m.includes('not configured')) return false;
  if (m.includes('zo api error: 4')) return false; // 4xx (auth/bad request)
  if (m.includes('parse error')) return false;
  return true; // network / 5xx / aborted → retry
}

async function askZoStream(port, msg) {
  const maxRetries = 3;
  const baseDelay = 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Port went away (panel closed) — stop immediately, no more API calls.
    if (port._dead) {
      throw new Error('Port disconnected');
    }
    try {
      if (attempt > 1) {
        // Announce the retry first, then the banner. *_DONE is only sent
        // after the final attempt succeeds (handled implicitly by the
        // successful return below, which clears the banner via STREAM_CHUNK).
        if (!safePost(port, { sessionId: msg.sessionId, type: 'STREAM_RECONNECT', attempt, maxRetries })) {
          throw new Error('Port disconnected');
        }
      }
      return await _askZoStreamImpl(port, msg);
    } catch (err) {
      lastError = err;
      // Don't retry if the port is gone or the error is non-transient.
      if (port._dead || !isRetriableStreamError(err)) throw err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ---- Stream content extraction ----
// Zo's /zo/ask SSE stream is documented (AGENTS.md) as:
//   event: FrontendModelResponse → text in data.content
//   event: End                   → full answer in data.output
//   event: Error                 → message in data.message
// But the per-event payload shape varies across model providers behind Zo
// (OpenAI delta.content, Anthropic delta.text, nested message.content, etc.)
// and the docs don't fully specify it. Extract from any known field so a
// valid response is never dropped and shown as "Done." (ticket #29).
function extractStreamContent(parsed) {
  if (parsed == null) return '';
  // Direct scalar fields (Zo canonical: content/output/text/response/message)
  if (typeof parsed.content === 'string') return parsed.content;
  if (typeof parsed.output === 'string') return parsed.output;
  if (typeof parsed.text === 'string') return parsed.text;
  if (typeof parsed.response === 'string') return parsed.response;
  // OpenAI-style chat completion: choices[0].delta.content
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (choice?.delta?.content) return safeText(choice.delta.content);
  if (choice?.message?.content) return safeText(choice.message.content);
  // Anthropic-style: delta.text / content_block_delta
  if (parsed.delta?.text) return safeText(parsed.delta.text);
  if (parsed.delta?.content) return safeText(parsed.delta.content);
  if (parsed.delta?.content_delta) return safeText(parsed.delta.content_delta);
  // Nested message.content
  if (parsed.message?.content) return safeText(parsed.message.content);
  // output may be an object (e.g. {reasoning, actions}) — stringify as last resort
  if (parsed.output != null && typeof parsed.output === 'object') {
    return safeText(JSON.stringify(parsed.output));
  }
  return '';
}

// ---- Safe text helper ----
function safeText(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  try { const s = JSON.stringify(v); return typeof s === 'string' ? s : ''; }
  catch { return ''; }
}

// Zo Co-browse — Background Service Worker
// Manages Zo API communication, settings, and message routing

const DEFAULTS = {
  zoApiUrl: 'https://api.zo.computer/zo/ask',
  zoModel: '',
  zoSpaceEndpoint: 'https://cashlessconsumer.zo.space',
  zoPersonaId: '',          // backward compat — overrides routing when set alone
  zoLitePersonaId: '',
  zoFullPersonaId: '',
  personaMode: 'auto',      // 'auto' | 'lite' | 'full'
  zoAccessToken: '',
  enableScreenshots: true,  // capture page screenshots for visual context
  enabledMenus: {        // which context menu items are active
    page: true,
    selection: true,
    link: true,
    editable: true,
  },
};

let config = { ...DEFAULTS };
// Track Zo API conversation ID for multi-turn context
let zoConversationId = null;
// Recover conversation ID from session storage (survives MV3 SW restart but not browser close)
chrome.storage.session.get('zoConversationId').then(s => {
  if (s.zoConversationId) zoConversationId = s.zoConversationId;
}).catch(e => console.debug('session.get(zoConversationId):', e));


// ---- Intent Classification ----
// Lite keywords — page-content tasks that don't need Zo's toolchain
const LITE_KEYWORDS = [
  'summarize', 'summary', 'tl;dr', 'tldr', 'extract',
  'what is this', 'what does this say', 'what does it say',
  'list the', 'find the', 'who is', 'when was', 'how many',
  'is there', 'does this', 'give me a', 'write a summary',
  'in short', 'key points', 'main points', 'quick overview',
  'bullet point', 'shorten', 'condense', 'translate',
];

// Full keywords — tasks that need Zo's full capabilities
const FULL_KEYWORDS = [
  'skill', 'data', 'duckdb', 'database', 'file', 'files',
  'automati', 'automation', 'create', 'set up', 'run',
  'query', 'workspace', 'project', 'folder', 'search for',
  'remember', 'save this', 'my files', 'browse files',
  'check my', 'look up', 'find in my', 'search my',
  'configure', 'settings', 'persona', 'model',
  'deploy', 'publish', 'upload', 'download',
  'telegram', 'email', 'slack', 'discord',
];

function classifyIntent(userQuery, pageContext) {
  if (!userQuery) return 'full'; // empty query = full (safe fallback)
  const q = userQuery.toLowerCase().trim();

  // Short queries under 10 words that aren't tool references
  const words = q.split(/\s+/).filter(Boolean);
  const hasFullKeyword = FULL_KEYWORDS.some(kw => q.includes(kw));
  const hasLiteKeyword = LITE_KEYWORDS.some(kw => q.includes(kw));

  // If it explicitly references tools, always full
  if (hasFullKeyword) return 'full';

  // If it's a short page-content query, classify as lite
  if (words.length <= 12 && hasLiteKeyword) return 'lite';

  // Very short queries (1-3 words) are likely page questions
  if (words.length <= 3 && !hasFullKeyword) return 'lite';

  // If page has form fields and query is about filling/interacting
  const hasForms = pageContext?.formFields?.length > 0;
  const interactionWords = ['fill', 'click', 'submit', 'type', 'enter', 'select', 'choose', 'press'];
  if (hasForms && interactionWords.some(w => q.includes(w))) {
    return 'lite';
  }

  // Multi-step or longer queries → full
  if (words.length > 15) return 'full';

  // Ambiguous — safe fallback to full
  return 'full';
}

// ---- Init ----
chrome.storage.sync.get(
  ['zoApiUrl', 'zoModel', 'zoPersonaId', 'zoLitePersonaId', 'zoFullPersonaId', 'personaMode', 'enableScreenshots', 'enabledMenus'],
  (result) => {
    if (result.zoApiUrl) config.zoApiUrl = result.zoApiUrl;
    if (result.zoModel) config.zoModel = result.zoModel;
    if (result.zoPersonaId) config.zoPersonaId = result.zoPersonaId;
    if (result.zoLitePersonaId) config.zoLitePersonaId = result.zoLitePersonaId;
    if (result.zoFullPersonaId) config.zoFullPersonaId = result.zoFullPersonaId;
    if (result.personaMode) config.personaMode = result.personaMode;
    if (result.enableScreenshots !== undefined) config.enableScreenshots = result.enableScreenshots;
      if (result.enabledMenus) config.enabledMenus = { ...config.enabledMenus, ...result.enabledMenus };
  }
);
// Sensitive config from storage.local (not synced)
chrome.storage.local.get(
  ['zoAccessToken', 'zoSpaceEndpoint'],
  (result) => {
    if (result.zoAccessToken) config.zoAccessToken = result.zoAccessToken;
    if (result.zoSpaceEndpoint) config.zoSpaceEndpoint = result.zoSpaceEndpoint;
  }
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (changes.zoApiUrl?.newValue) config.zoApiUrl = changes.zoApiUrl.newValue;
  if (changes.zoModel?.newValue) config.zoModel = changes.zoModel.newValue;
  if (changes.zoPersonaId?.newValue) config.zoPersonaId = changes.zoPersonaId.newValue;
  if (changes.zoLitePersonaId?.newValue) config.zoLitePersonaId = changes.zoLitePersonaId.newValue;
  if (changes.zoFullPersonaId?.newValue) config.zoFullPersonaId = changes.zoFullPersonaId.newValue;
  if (changes.personaMode?.newValue) config.personaMode = changes.personaMode.newValue;
  if (changes.zoAccessToken?.newValue) config.zoAccessToken = changes.zoAccessToken.newValue;
  else if (changes.zoAccessToken?.oldValue && !changes.zoAccessToken?.newValue) config.zoAccessToken = undefined;
  if (changes.zoSpaceEndpoint?.newValue) config.zoSpaceEndpoint = changes.zoSpaceEndpoint.newValue;
  else if (changes.zoSpaceEndpoint?.oldValue && !changes.zoSpaceEndpoint?.newValue) config.zoSpaceEndpoint = undefined;
    if (changes.enabledMenus?.newValue) { config.enabledMenus = { ...config.enabledMenus, ...changes.enabledMenus.newValue }; recreateContextMenus(); }
  if (changes.enableScreenshots?.newValue !== undefined) config.enableScreenshots = changes.enableScreenshots.newValue;
});

// Open side panel on toolbar icon click (global scope — takes effect on every SW wake-up).
// setPanelBehavior covers the click; no separate action.onClicked listener needed.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---- Message handler ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'GET_PAGE_CONTEXT': {
      getActiveTabContext(sender.tab?.id, request.liteMode).then(sendResponse);
      return true;
    }
    case 'ASK_ZO': {
      askZo(request.pageContext, request.userQuery, request.modelName, request.personaId, request.presetSystemPrompt, request.presetInstructions, request.intent).then(sendResponse);
      return true;
    }
    case 'RECREATE_CONTEXT_MENUS':
      recreateContextMenus();
      sendResponse({ ok: true });
      return true;
    case 'TEST_CONNECTION': {
      testConnection().then(sendResponse);
      return true;
    }
    case 'GET_CONFIG': {
      sendResponse(sanitizedConfig());
      return true;
    }
    case 'NEW_CONVERSATION': {
      zoConversationId = null;
      chrome.storage.session.set({ zoConversationId: null }).catch(e => console.debug('session.set:', e));
      sendResponse({ ok: true });
      return true;
    }
    case 'LIST_MODELS': {
      listModels().then(sendResponse);
      return true;
    }
    case 'LIST_PERSONAS': {
      listPersonas().then(sendResponse);
      return true;
    }
    case 'EXECUTE_ACTIONS': {
      executeActions(request.actions, request.tabId || sender.tab?.id).then(sendResponse);
      return true;
    }
    case 'NAVIGATE': {
      const navTabId = request.tabId || sender.tab?.id;
      if (!navTabId || !request.url) {
        sendResponse({ ok: false, error: 'NAVIGATE requires tabId and url' });
        return false;
      }
      chrome.tabs.update(navTabId, { url: request.url }).then(() =>
        sendResponse({ ok: true })
      ).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    case 'GENERATE_PRESET': {
      generatePreset(request.description).then(sendResponse);
      return true;
    }
    case 'SAVE_PAGE': {
      savePageToWorkspace(request.pageContext, request.savePath).then(sendResponse);
      return true;
    }
    case 'RUN_SKILL': {
      runSkill(request.skillName, request.pageContext).then(sendResponse);
      return true;
    }
    case 'CREATE_AUTOMATION': {
      createAutomation(request.instruction || '', request.rrule || 'FREQ=DAILY', request.pageContext).then(sendResponse);
      return true;
    }
    case 'LIST_AUTOMATIONS': {
      listAutomations().then(sendResponse);
      return true;
    }
    case 'DUCKDB_QUERY': {
      runDuckdbQuery(request.naturalQuery).then(sendResponse);
      return true;
    }
  }
});

// ---- Core ----

function sanitizedConfig() {
  return {
    zoApiUrl: config.zoApiUrl,
    zoModel: config.zoModel,
    zoPersonaId: config.zoPersonaId,
    zoLitePersonaId: config.zoLitePersonaId,
    zoFullPersonaId: config.zoFullPersonaId,
    personaMode: config.personaMode,
    enableScreenshots: config.enableScreenshots,
    enabledMenus: config.enabledMenus,
    zoSpaceEndpoint: config.zoSpaceEndpoint,
    hasToken: !!config.zoAccessToken,
    zoConversationId: zoConversationId,
  };
}

// ---- Route context capture and action execution through content script ----
// ---- Timeout wrapper ----
function withTimeout(promise, ms = 8000, label = 'operation') {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(id)), timeout]);
}

// ---- Debugger-based page eval (primary path, mirrors Kilo Code pattern) ----

const debuggerTabMap = new Map();

async function attachDebugger(tabId) {
  if (debuggerTabMap.get(tabId)?.attached) return true;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerTabMap.set(tabId, { attached: true });
    return true;
  } catch {
    return false;
  }
}

function detachDebugger(tabId) {
  if (debuggerTabMap.get(tabId)?.attached) {
    try { chrome.debugger.detach({ tabId }); } catch {}
    debuggerTabMap.delete(tabId);
  }
}

// Detach debugger when tab closes — prevents stale debugger sessions
chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
});

async function evalInPage(tabId, expression, timeoutMs = 8000) {
  if (!await attachDebugger(tabId)) return { ok: false, error: 'debugger unavailable' };
  try {
    const result = await withTimeout(
      chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }),
      timeoutMs,
      'Runtime.evaluate'
    );
    return { ok: true, value: result?.result?.value };
  } catch (e) {
    detachDebugger(tabId);
    return { ok: false, error: e.message };
  }
}

function makeActionEval(action) {
  const a = JSON.stringify(action);
  return `(() => {
    const a = ${a};
    try {
      if (a.type === 'navigate' || a.type === 'done') return { ok: true, type: a.type };
      const el = a.selector ? document.querySelector(a.selector) : null;
      if (a.selector && !el) return { ok: false, error: 'Element not found: ' + a.selector, type: a.type };
      switch (a.type) {
        case 'click':
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { ok: true, type: 'click' };
        case 'fill':
          el.focus();
          el.value = '';
          el.value = a.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, type: 'fill' };
        case 'extract':
          return { ok: true, type: 'extract', value: (a.attribute ? el.getAttribute(a.attribute) : el.textContent?.trim()) || '' };
        case 'scroll':
          const amt = a.amount || innerHeight * 0.7;
          scrollBy({ left: 0, top: a.direction === 'up' ? -amt : amt, behavior: 'smooth' });
          return { ok: true, type: 'scroll' };
        case 'wait':
          return new Promise(r => setTimeout(() => r({ ok: true, type: 'wait' }), a.ms || 1000));
        default:
          return { ok: false, error: 'Unknown action: ' + a.type };
      }
    } catch(e) { return { ok: false, error: e.message, type: a.type }; }
  })()`;
}



async function getActiveTabContext(tabId, liteMode) {
  let tab;
  if (tabId) {
    // Look up the full tab so we have windowId for captureVisibleTab; fall
    // back to the synthesized object if the lookup fails (tab closed, etc.).
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      tab = { id: tabId };
    }
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }
  if (!tab?.id) return { error: 'No active tab' };

  let context;

  // Path 1: Debugger-based eval (fastest, works on any page)
  try {
    var captureExpr = liteMode
      ? `(function(){
          var t=document.body?.innerText||'';
          return {
            url: location.href,
            title: document.title,
            visibleText: t.substring(0,2000),
            viewport: { w: window.innerWidth, h: window.innerHeight }
          };
        })()`
      : `(function(){
          var m=document.querySelector('main,article,[role="main"],#content,.content');
          var b=document.body;
          var t=(m||b)?.innerText||'';
          var ff=[];
          document.querySelectorAll('input:not([type="hidden"]),textarea,select').forEach(function(el){
            var r=el.getBoundingClientRect();
            if(r.width===0||r.height===0)return;
            ff.push({tag:el.tagName.toLowerCase(),type:el.type||'text',name:el.name||el.id||'',placeholder:el.placeholder||''});
          });
          return {url:location.href,title:document.title,visibleText:t.substring(0,8000),formFields:ff.slice(0,30),viewport:{w:window.innerWidth,h:window.innerHeight}};
        })()`;
    var result = await evalInPage(tab.id, captureExpr, 5000);
    if (result.ok && result.value && result.value.url) context = result.value;
  } catch(e) {
    // debugger not available — fall through
  }

  // Path 2: Content script
  if (!context) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_CONTEXT', liteMode });
      if (resp && !resp.error) context = resp;
    } catch {
      // content script not injected — fall through
    }
  }

  // Path 3: executeScript fallback
  if (!context) {
    try {
      const captureFn = liteMode
        ? () => {
            const text = document.body?.innerText || '';
            return {
              url: location.href,
              title: document.title,
              visibleText: text.substring(0, 2000),
              viewport: { w: window.innerWidth, h: window.innerHeight },
            };
          }
        : () => {
            const main = document.querySelector('main, article, [role="main"], #content, .content');
            const body = document.body;
            const text = (main || body)?.innerText || '';
            const formFields = [];
            document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              formFields.push({ tag: el.tagName.toLowerCase(), type: el.type || 'text', name: el.name || el.id || '', placeholder: el.placeholder || '' });
            });
            return { url: location.href, title: document.title, visibleText: text.substring(0, 8000), formFields: formFields.slice(0, 30), viewport: { w: window.innerWidth, h: window.innerHeight } };
          };
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureFn });
      context = result?.result || { error: 'Could not capture context' };
    } catch (err) {
      context = { error: err.message };
    }
  }

  // Capture screenshot if enabled and context is valid
  if (context && !context.error && config.enableScreenshots !== false) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg' });
      context.screenshotDataUrl = dataUrl;
    } catch (e) {
      console.warn('Screenshot capture skipped:', e.message);
    }
  }

  return context;
}

// ---- Resolve which persona to use ----
function resolvePersona(userQuery, pageContext) {
  // If a specific persona is configured (backward compat), use it directly
  if (config.zoPersonaId && !config.zoLitePersonaId && !config.zoFullPersonaId) {
    return { personaId: config.zoPersonaId, intent: 'custom' };
  }

  const mode = config.personaMode || 'auto';

  if (mode === 'lite') {
    return { personaId: config.zoLitePersonaId || config.zoPersonaId || '', intent: 'lite' };
  }
  if (mode === 'full') {
    return { personaId: config.zoFullPersonaId || config.zoPersonaId || '', intent: 'full' };
  }

  // Auto mode — classify
  const intent = classifyIntent(userQuery, pageContext);
  if (intent === 'lite' && config.zoLitePersonaId) {
    return { personaId: config.zoLitePersonaId, intent: 'lite' };
  }
  if (intent === 'full' && config.zoFullPersonaId) {
    return { personaId: config.zoFullPersonaId, intent: 'full' };
  }
  // Fallback: whatever's configured, or none
  return { personaId: config.zoPersonaId || '', intent };
}

// ---- Streaming port handler ----

/** Persistent port connections from sidepanel for streaming Zo responses. */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cobrowse-stream') return;

  // Track disconnects so streaming code can stop posting to a dead port
  // instead of throwing "Attempting to use a disconnected port object".
  port.onDisconnect.addListener(() => { port._dead = true; });

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      case 'ASK_ZO': {
        try {
          await askZoStream(port, msg);
        } catch (err) {
          // Final failure after retries (or a non-retriable error). Only try
          // to surface it if the port is still alive.
          safePost(port, { sessionId: msg.sessionId, type: 'STREAM_ERROR', error: `Failed: ${err.message}` });
        }
        break;
      }
      case 'NEW_CONVERSATION': {
        zoConversationId = null;
        chrome.storage.session.set({ zoConversationId: null }).catch(e => console.debug('session.set:', e));
        break;
      }
    }
  });
});

// ---- Context Menu ----

const CONTEXT_MENU_ITEMS = [
  { id: 'cobrowse-page',      title: 'Ask Zo about this page',      contexts: ['page'] },
  { id: 'cobrowse-save',      title: 'Save page to Zo workspace',   contexts: ['page'] },
  { id: 'cobrowse-selection', title: 'Ask Zo about this selection', contexts: ['selection'] },
  { id: 'cobrowse-link',      title: 'Ask Zo about this link',      contexts: ['link'] },
  { id: 'cobrowse-fill',      title: 'Ask Zo to fill this field',   contexts: ['editable'] },
];

function recreateContextMenus() {
  chrome.contextMenus.removeAll(() => {
    const menus = config.enabledMenus || DEFAULTS.enabledMenus;
    for (const item of CONTEXT_MENU_ITEMS) {
      if (menus[item.contexts[0]]) {
        chrome.contextMenus.create({
          id: item.id,
          title: item.title,
          contexts: item.contexts,
        });
      }
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let query = '';
  let contextType = info.menuItemId;

  switch (info.menuItemId) {
    case 'cobrowse-page':
      query = 'Analyze this page and give me a summary of what it contains.';
      break;
    case 'cobrowse-save': {
      // Save page content to Zo workspace
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        await new Promise(r => setTimeout(r, 500));
        const pageContext = await getActiveTabContext(tab.id);
        const result = await savePageToWorkspace(pageContext);
        await chrome.storage.session.set({ pendingZoQuery: { text: result.ok ? `✅ Saved to ${result.path}` : `❌ Save failed: ${result.error}`, source: 'save', personaId: null } });
        chrome.runtime.sendMessage({ type: 'PENDING_ZO_QUERY', text: result.ok ? `✅ Saved to ${result.path}` : `❌ Save failed: ${result.error}`, source: 'save' }).catch(() => {});
      } catch (err) {
        console.error('Save from context menu error:', err);
      }
      return;
    }
    case 'cobrowse-selection':
      query = info.selectionText
        ? `Explain or act on this selection: ${info.selectionText.substring(0, 2000)}`
        : 'Analyze this page.';
      break;
    case 'cobrowse-link':
      query = info.linkUrl
        ? `Visit and analyze this link: ${info.linkUrl}`
        : 'Analyze this link.';
      break;
    case 'cobrowse-fill':
      query = 'Fill this form field based on the page context.';
      break;
  }

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    // Small delay for sidepanel to initialize
    await new Promise(r => setTimeout(r, 500));
    // Store pending query for sidepanel to pick up
    await chrome.storage.session.set({ pendingZoQuery: { text: query, source: contextType, personaId: null } });
    // Broadcast to sidepanel if already open — also clear so subsequent init checks don't re-fire
    chrome.runtime.sendMessage({ type: 'PENDING_ZO_QUERY', text: query, source: contextType }).catch(() => {});
  } catch (err) {
    console.error('Context menu error:', err);
  }
});

// Re-create context menus on every service worker wake-up (MV3: SW restarts lose menus)
recreateContextMenus();

// Also re-create on install and browser start

// Clean up debugger state when detached (tab closed, user pressed F12, etc.)
if (chrome.debugger) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) detachDebugger(source.tabId);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  recreateContextMenus();
});
chrome.runtime.onStartup.addListener(() => recreateContextMenus());

// ── Keyboard Shortcuts (chrome.commands) ──
// Commands are registered in manifest.json. MV3 does not support dynamic
// registration; users remap them at chrome://extensions/shortcuts
chrome.commands.onCommand.addListener(async (command, tab) => {
  const activeTab = tab || (await getActiveTab());
  if (!activeTab) return;
  const windowId = activeTab.windowId;

  // Every shortcut opens the side panel first
  try {
    await chrome.sidePanel.open({ windowId });
  } catch (err) {
    console.error('Keyboard shortcut: could not open side panel:', err);
    return;
  }

  // Default: just open the panel (no query). Used by _execute_action.
  let query = '';
  let source = command;

  switch (command) {
    case 'summarize-page':
      query = 'Summarize this page in 3-5 bullet points and highlight anything actionable.';
      source = 'shortcut-summarize';
      break;
    case 'new-chat':
      // Signal sidepanel to start a fresh conversation, then open
      query = '';
      source = 'shortcut-new-chat';
      break;
    case 'extract-page':
      query = 'Extract the key data from this page into a structured table.';
      source = 'shortcut-extract';
      break;
    case '_execute_action':
      // Plain toolbar button / open-panel shortcut — no query
      return;
  }

  // Small delay for sidepanel to initialize before we hand off the query
  await new Promise(r => setTimeout(r, 400));

  if (source === 'shortcut-new-chat') {
    chrome.runtime
      .sendMessage({ type: 'NEW_CONVERSATION', source: 'shortcut' })
      .catch(() => {});
    return;
  }

  await chrome.storage.session.set({ pendingZoQuery: { text: query, source } });
  chrome.runtime
    .sendMessage({ type: 'PENDING_ZO_QUERY', text: query, source })
    .catch(() => {});
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ── Omnibox Commands (chrome.omnibox) ──
// Users type "zo <query>" in the address bar. We provide suggestions for
// known !commands and route everything else to the side panel as a query.
const OMNIBOX_COMMANDS = {
  'summarize': 'Summarize this page',
  'extract': 'Extract structured data from this page',
  'research': 'Deep research on the current page topic',
  'help': 'Show available Zo commands',
};

chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({
    description: 'zo — Ask Zo about this page (type a question or command)',
  });
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) {
    chrome.omnibox.setDefaultSuggestion({
      description: 'zo — Type a question or !command (try: summarize, extract, research)',
    });
    return;
  }

  // Check if user is typing a known command
  const matching = Object.entries(OMNIBOX_COMMANDS)
    .filter(([cmd]) => cmd.startsWith(trimmed));

  if (matching.length) {
    const suggestions = matching.map(([cmd, desc]) => ({
      content: cmd,
      description: `zo ${cmd} — ${desc}`,
    }));
    suggest(suggestions);
    chrome.omnibox.setDefaultSuggestion({
      description: `zo ${trimmed} — ${matching[0][1]}`,
    });
  } else {
    chrome.omnibox.setDefaultSuggestion({
      description: `zo ${text} — Ask Zo: "${text}"`,
    });
  }
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const query = text.trim();
  if (!query) return;

  // Normalize !commands typed without the bang
  let normalizedQuery = query;
  if (OMNIBOX_COMMANDS[query.toLowerCase()]) {
    normalizedQuery = `!${query.toLowerCase()}`;
  }

  // Open side panel and push the query
  const tab = await getActiveTab();
  if (tab) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    await sleep(300);
    await chrome.storage.session.set({
      pendingZoQuery: { text: normalizedQuery, source: 'omnibox', ts: Date.now() },
    });
  }
});
async function _askZoStreamImpl(port, msg) {
  const { pageContext, userQuery, modelName, personaId, presetSystemPrompt, presetInstructions, intent } = msg;
  const sid = msg.sessionId;

  if (!config.zoAccessToken) {
    safePost(port, { sessionId: sid, type: 'STREAM_ERROR', error: '❌ Zo access token not configured. Open extension settings to set it up.' });
    return;
  }

  // Resolve persona
  let resolvedPersonaId = personaId;
  let resolvedIntent = intent;
  if (!resolvedPersonaId) {
    const routing = resolvePersona(userQuery, pageContext);
    resolvedPersonaId = routing.personaId;
    resolvedIntent = routing.intent;
  }

  const isLite = resolvedIntent === 'lite';

  const systemPrompt = presetSystemPrompt || (
    isLite
      ? `You are Zo — the user's browser companion. You see the page they're on. Keep responses concise and scannable.`
      : `You are Zo — the user's AI co-browsing assistant. You see the page they're on and can control the browser.`
  );
  const instructions = presetInstructions || (
    isLite
      ? `## Instructions\nRespond conversationally and concisely. Answer based on the page content provided below. No actions needed — just respond with helpful text formatted as plain markdown.`
      : `## Instructions\nThink step by step about what actions to take, then respond with a valid JSON object.\n\n{\n  "reasoning": "your step-by-step thinking",\n  "actions": [\n    {\n      "type": "navigate" | "click" | "fill" | "extract" | "scroll" | "wait" | "done",\n      // For navigate: { "url": "..." }\n      // For click/extract: { "selector": "css-selector" }\n      // For fill: { "selector": "css-selector", "value": "text to type" }\n      // For extract: { "selector": "css-selector", "attribute": "textContent|href|src|..." }\n      // For scroll: { "direction": "up"|"down", "amount": 300 }\n      // For wait: { "ms": 1000 }\n      // For done: { "response": "summary of what happened / answer for user" }\n    }\n  ]\n}`
  );

  const prompt = `${systemPrompt}\n\n## Current Page\n- **URL:** ${pageContext.url}\n- **Title:** ${pageContext.title}\n- **Viewport:** ${pageContext.viewport?.w || '?'}x${pageContext.viewport?.h || '?'}\n\n## Page Content (visible text)\n\`\`\`\n${(pageContext.visibleText || '—empty—').substring(0, isLite ? 2000 : 4000)}\n\`\`\`\n${pageContext.formFields ? `\n## Interactive Elements\n${JSON.stringify(pageContext.formFields || [], null, 2)}\n` : ''}${pageContext.screenshotDataUrl ? `\n\n## Page Screenshot\n![Current page](${pageContext.screenshotDataUrl})` : ''}\n\n## User Request\n${userQuery}\n\n  ${instructions}`;

  try {
    const response = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        input: prompt,
        model_name: (modelName || config.zoModel) || undefined,
        conversation_id: zoConversationId || undefined,
        stream: true,
        ...(resolvedPersonaId ? { persona_id: resolvedPersonaId } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const errMsg = `Zo API error: ${response.status}${body ? ' — ' + body.substring(0, 200) : ''}`;
      safePost(port, { sessionId: sid, type: 'STREAM_ERROR', error: errMsg });
      // Surface 4xx as a thrown retriable=false error so the retry wrapper stops.
      if (response.status >= 400 && response.status < 500) {
        const e = new Error(errMsg); throw e;
      }
      return;
    }

    // Handle non-streaming JSON responses (models that don't support SSE)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const data = await response.json();
        if (data.conversation_id) { zoConversationId = data.conversation_id; chrome.storage.session.set({ zoConversationId }).catch(e => console.debug('session.set:', e)); }
        finishStream(port, sid, data.output || '', resolvedIntent);
      } catch (e) {
        safePost(port, { sessionId: sid, type: 'STREAM_ERROR', error: `Non-streaming parse error: ${e.message}` });
      }
      return;
    }

    // Capture conversation_id from response headers
    const convHeaderId = response.headers.get('x-conversation-id');
    if (convHeaderId) { zoConversationId = convHeaderId; chrome.storage.session.set({ zoConversationId }).catch(e => console.debug('session.set:', e)); }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    let currentEventType = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('event: ')) {
          currentEventType = trimmed.slice(7).trim();
          continue;
        }
        // Also handle event: without trailing space (valid SSE)
        if (trimmed.startsWith('event:')) {
          currentEventType = trimmed.slice(6).trim();
          continue;
        }

        // Handle both data: (with space) and data: (without space)
        const dataMatch = trimmed.match(/^data:\s?(.*)$/);
        if (dataMatch) {
          const data = dataMatch[1].trim();
          if (!data) continue;

          // End event — stream completed
          if (currentEventType === 'End') {
            if (data !== '{}' && data !== '') {
              try {
                const parsed = JSON.parse(data);
                // Don't clobber accumulated streamed text with the final payload
                // unless we never received incremental chunks.
                if (!fullText) {
                  // Prefer the documented output field, then any content field,
                  // then the structured reasoning/actions payload.
                  const endContent = typeof parsed.output === 'string' ? parsed.output : '';
                  fullText = endContent || extractStreamContent(parsed) || ((parsed.reasoning || parsed.actions) ? safeText(parsed) : '');
                }
              } catch {}
            }
            finishStream(port, sid, fullText, resolvedIntent);
            currentEventType = '';
            return;
          }

          // Error event
          if (currentEventType === 'Error') {
            try {
              const parsed = JSON.parse(data);
              safePost(port, { sessionId: sid, type: 'STREAM_ERROR', error: parsed.message || 'Stream error' });
            } catch {
              safePost(port, { sessionId: sid, type: 'STREAM_ERROR', error: data });
            }
            currentEventType = '';
            return;
          }

          // FrontendModelResponse (default — also catches any data: without event: prefix for compat)
          try {
            const parsed = JSON.parse(data);
            // One-time diagnostic: log the first real chunk's event + fields so
            // the actual Zo/model SSE shape is observable. The repo has never
            // captured a real chunk; this makes field mismatches debuggable.
            if (!fullText) {
              try { console.debug('[zo-cobrowse] first SSE chunk:', { event: currentEventType, fields: Object.keys(parsed) }); } catch {}
            }
            // Extract text from any known field shape (Zo/OpenAI/Anthropic/nested).
            const content = extractStreamContent(parsed);
            if (content) {
              fullText += content;
              safePost(port, { sessionId: sid, type: 'STREAM_CHUNK', text: fullText });
            }
            // Legacy finish check for non-Zo SSE formats (OpenAI, Anthropic style)
            if (parsed.done || parsed.finish_reason || parsed.type === 'final' || parsed.type === 'complete' || parsed.type === 'End') {
              if (parsed.output && !fullText) fullText = safeText(parsed.output);
              else if (parsed.type === 'End' && parsed.reasoning && !fullText) fullText = safeText(parsed);
              finishStream(port, sid, fullText, resolvedIntent);
              return;
            }
          } catch {
            // Plain text SSE (e.g. [DONE])
            if (data === '[DONE]') {
              finishStream(port, sid, fullText, resolvedIntent);
              return;
            }
            fullText += safeText(data);
            safePost(port, { sessionId: sid, type: 'STREAM_CHUNK', text: fullText });
          }
        }
      }
    }

    // Stream ended (no End event received — graceful fallback)
    finishStream(port, sid, fullText, resolvedIntent);
  } catch (err) {
    safePost(port, { sessionId: sid, type: 'STREAM_ERROR', error: `Connection failed: ${err.message}` });
    throw err; // let the retry wrapper decide
  }
}

function finishStream(port, sid, output, intent) {
  let reasoning = '';
  let actions = [];
  let rawOutput = '';
  let plainText = '';  // non-JSON answer text, surfaced directly to the user

  // Normalize to string for consistent parsing
  const normalizedOutput = (typeof output === 'object' && output !== null)
    ? output
    : String(output ?? '');

  if (typeof normalizedOutput === 'object' && normalizedOutput !== null) {
    reasoning = normalizedOutput.reasoning || '';
    actions = normalizedOutput.actions || [];
    rawOutput = safeText(JSON.stringify(normalizedOutput));
  } else if (typeof normalizedOutput === 'string') {
    try {
      const parsed = JSON.parse(normalizedOutput);
      if (parsed && typeof parsed === 'object') {
        reasoning = parsed.reasoning || '';
        actions = parsed.actions || [];
        rawOutput = safeText(JSON.stringify(parsed));
      } else {
        // JSON but not an object (number/bool) — treat as plain text.
        plainText = safeText(normalizedOutput);
      }
    } catch {
      // Not JSON — this is a plain-text (markdown) answer. Show it directly
      // rather than routing through `reasoning` (ticket #29: plain-text
      // answers were only surfaced via reasoning and otherwise became "Done.").
      plainText = normalizedOutput;
    }
  }

  // Build the user-facing fullText from the resolved response.
  const doneAction = actions.find(a => a.type === 'done');
  const safeDoneResponse = safeText(doneAction?.response);
  const fullText = safeDoneResponse || plainText || reasoning || rawOutput || safeText(normalizedOutput);

  safePost(port, {
    sessionId: sid,
    type: 'STREAM_DONE',
    reasoning,
    actions,
    fullText,
  });
}

async function askZo(pageContext, userQuery, modelName, personaId, presetSystemPrompt, presetInstructions, intent) {
  if (!config.zoAccessToken) {
    return { error: '❌ Zo access token not configured. Open extension settings to set it up.' };
  }

  // Resolve persona
  let resolvedPersonaId = personaId;
  let resolvedIntent = intent;
  if (!resolvedPersonaId) {
    const routing = resolvePersona(userQuery, pageContext);
    resolvedPersonaId = routing.personaId;
    resolvedIntent = routing.intent;
  }

  const isLite = resolvedIntent === 'lite';

  // Use preset prompts or persona-specific defaults
  const systemPrompt = presetSystemPrompt || (
    isLite
      ? `You are Zo — the user's browser companion. You see the page they're on. Keep responses concise and scannable.`
      : `You are Zo — the user's AI co-browsing assistant. You see the page they're on and can control the browser.`
  );
  const instructions = presetInstructions || (
    isLite
      ? `## Instructions\nRespond conversationally and concisely. Answer based on the page content provided below. No actions needed — just respond with helpful text formatted as plain markdown.`
      : `## Instructions\nThink step by step about what actions to take, then respond with a valid JSON object.\n\n{\n  "reasoning": "your step-by-step thinking",\n  "actions": [\n    {\n      "type": "navigate" | "click" | "fill" | "extract" | "scroll" | "wait" | "done",\n      // For navigate: { "url": "..." }\n      // For click/extract: { "selector": "css-selector" }\n      // For fill: { "selector": "css-selector", "value": "text to type" }\n      // For extract: { "selector": "css-selector", "attribute": "textContent|href|src|..." }\n      // For scroll: { "direction": "up"|"down", "amount": 300 }\n      // For wait: { "ms": 1000 }\n      // For done: { "response": "summary of what happened / answer for user" }\n    }\n  ]\n}`
  );

  const prompt = `${systemPrompt}\n\n## Current Page\n- **URL:** ${pageContext.url}\n- **Title:** ${pageContext.title}\n- **Viewport:** ${pageContext.viewport?.w || '?'}x${pageContext.viewport?.h || '?'}\n\n## Page Content (visible text)\n\`\`\`\n${(pageContext.visibleText || '—empty—').substring(0, isLite ? 2000 : 4000)}\n\`\`\`\n${pageContext.formFields ? `\n## Interactive Elements\n${JSON.stringify(pageContext.formFields || [], null, 2)}\n` : ''}${pageContext.screenshotDataUrl ? `\n\n## Page Screenshot\n![Current page](${pageContext.screenshotDataUrl})` : ''}\n\n## User Request\n${userQuery}\n\n  ${instructions}`;

  try {
    const response = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        model_name: (modelName || config.zoModel) || undefined,
        conversation_id: zoConversationId || undefined,
        ...(resolvedPersonaId ? { persona_id: resolvedPersonaId } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        error: `Zo API error: ${response.status}${body ? ' — ' + body.substring(0, 200) : ''}`,
      };
    }

    const data = await response.json();
    if (data.conversation_id) { zoConversationId = data.conversation_id; chrome.storage.session.set({ zoConversationId }).catch(e => console.debug('session.set:', e)); }
    return { success: true, output: data.output, intent: resolvedIntent };
  } catch (err) {
    return { error: `Connection failed: ${err.message}` };
  }
}

// Derive the API origin from config.zoApiUrl so a self-hosted / overridden
// endpoint is respected instead of always hitting api.zo.computer.
function apiOrigin() {
  try {
    return new URL(config.zoApiUrl).origin;
  } catch {
    return 'https://api.zo.computer';
  }
}

async function listModels() {
  if (!config.zoAccessToken) return { error: 'No token' };
  try {
    const r = await fetch(`${apiOrigin()}/models/available`, {
      headers: { Authorization: `Bearer ${config.zoAccessToken}` }
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const data = await r.json();
    // API returns { models: [{ model_name, label, vendor, ... }], featured_models_are_free }
    return { success: true, models: data.models || [] };
  } catch (err) {
    return { error: err.message };
  }
}

async function listPersonas() {
  if (!config.zoAccessToken) return { error: 'No token' };
  try {
    const r = await fetch(`${apiOrigin()}/personas/available`, {
      headers: { Authorization: `Bearer ${config.zoAccessToken}` }
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const data = await r.json();
    return { success: true, personas: data.personas || [] };
  } catch (err) {
    return { error: err.message };
  }
}


async function generatePreset(description) {
  if (!config.zoAccessToken) {
    return { error: 'No token' };
  }
  try {
    const r = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input: `You are a preset designer for a browser co-browsing AI assistant. Based on this user description, generate a preset configuration.\n\nUser description: ${description}\n\nCreate a preset with:\n1. name: A short, catchy name (2-4 words)\n2. description: One sentence explaining what this preset does\n3. systemPrompt: A paragraph setting the AI's role and behavior for this task (write as if addressing the AI directly, starting with \"You are Zo —\")\n4. instructions: Detailed instructions for how the AI should respond, including output format guidance. Include the JSON schema for actions.\n\nReturn ONLY valid JSON with these 4 fields. No markdown, no explanation.`,
        model_name: config.zoModel || undefined,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { error: `HTTP ${r.status}: ${body.substring(0, 200)}` };
    }
    const data = await r.json();
    const output = data.output;
    try {
      const preset = JSON.parse(output);
      return { success: true, preset: { ...preset, isBuiltin: false, createdAt: Date.now() } };
    } catch {
      return { error: 'Failed to parse Zo response as JSON' };
    }
  } catch (err) {
    return { error: err.message };
  }
}

async function testConnection() {
  if (!config.zoAccessToken) {
    return { success: false, error: 'No access token configured. Save one in settings first.' };
  }

  // Test 1: Zo API
  let zoOk = false;
  try {
    const r = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        input: 'Reply with just: ZO_OK',
        model_name: config.zoModel || undefined,
        conversation_id: zoConversationId || undefined,
      }),
    });
    if (r.ok) zoOk = true;
    const body = await r.text();
    // Case-insensitive check; trust r.ok as a fallback so a valid response
    // that doesn't echo the exact literal isn't reported as failure.
    if (!body.toLowerCase().includes('zo_ok')) zoOk = r.ok;
  } catch {
    // zoOk stays false
  }

  // Test 2: Zo.space endpoint
  let spaceOk = false;
  try {
    const r = await fetch(config.zoSpaceEndpoint, { method: 'HEAD' });
    spaceOk = r.ok || r.status === 301 || r.status === 302;
  } catch {
    // spaceOk stays false
  }

  return { success: zoOk, zoApi: zoOk, zoSpace: spaceOk };
}



async function executeActions(actions, tabId) {
  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0]?.id;
    if (!tabId) return { ok: false, error: 'No active tab' };
  }

  const results = [];
  for (const action of actions) {
    if (action.type === 'navigate') {
      await chrome.tabs.update(tabId, { url: action.url });
      results.push({ ok: true, type: 'navigate' });
      continue;
    }
    if (action.type === 'done') {
      results.push({ ok: true, type: 'done', response: action.response });
      continue;
    }

    let result;

    // Path 1: Debugger eval (fastest, works even if content script not loaded)
    if (action.selector || action.type === 'scroll') {
      try {
        const resp = await evalInPage(tabId, makeActionEval(action), 8000);
        if (resp.ok && resp.value && resp.value.ok) {
          result = resp.value;
        }
      } catch {
        // debugger not available — fall through
      }
    }

    // Path 2: Content script
    if (!result) {
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTION', action });
        result = resp || { ok: false, error: 'no response' };
      } catch {
        result = null;
      }
    }

    // Path 3: executeScript fallback
    if (!result) {
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: executeDomAction, args: [action] });
        result = r.result;
      } catch (err) {
        result = { ok: false, error: err.message };
      }
    }

    results.push(result);
    if (!result?.ok) break;
    if (action.type !== 'wait') await sleep(500);
  }

  const allOk = results.every(r => r && r.ok);
  const failed = results.find(r => r && !r.ok);
  return allOk
    ? { ok: true, results }
    : { ok: false, results, error: (failed && failed.error) || 'Action failed' };
}

function executeDomAction(action) {
  return new Promise((resolve, reject) => {
    const el = action.selector ? document.querySelector(action.selector) : null;
    if (!el && action.selector) {
      reject(new Error(`Element not found: ${action.selector}`));
      return;
    }
    switch (action.type) {
      case 'click':
        el.scrollIntoView({ block: 'center' });
        el.click();
        resolve({ ok: true, type: 'click' });
        break;
      case 'fill':
        el.focus();
        el.value = '';
        el.value = action.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        resolve({ ok: true, type: 'fill' });
        break;
      case 'extract':
        resolve({
          ok: true,
          type: 'extract',
          value: action.attribute ? el.getAttribute(action.attribute) : el.textContent?.trim(),
        });
        break;
      case 'scroll':
        window.scrollBy({
          left: 0,
          top: action.direction === 'up' ? -(action.amount || 300) : action.amount || 300,
          behavior: 'smooth',
        });
        resolve({ ok: true, type: 'scroll' });
        break;
      case 'wait':
        setTimeout(() => resolve({ ok: true, type: 'wait' }), action.ms || 1000);
        break;
      default:
        reject(new Error(`Unknown action: ${action.type}`));
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Save page content to Zo workspace as markdown (#09)
async function savePageToWorkspace(pageContext, savePath) {
  if (!config.zoAccessToken) return { ok: false, error: 'Zo access token not configured. Open settings to set it up.' };

  // Derive a clean filename from page title or use provided path
  const rawTitle = (pageContext && pageContext.title) || 'untitled';
  const cleanTitle = rawTitle.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 80);
  const path = savePath || `Documents/research/${cleanTitle}.md`;
  const url = (pageContext && pageContext.url) || '';
  const content = (pageContext && pageContext.visibleText) || '';

  // Build a markdown note with source attribution
  const markdown = `# ${(pageContext && pageContext.title) || 'Untitled'}\n\n> **Source:** ${url}\n\n> **Saved:** ${new Date().toISOString()}\n\n---\n\n${content}\n`;

  // Ask Zo to write the file
  const prompt = `Write the following content to the file at path \`${path}\` in my workspace. Create the directory if it does not exist. Use write_file or equivalent. Do not respond with anything other than a confirmation with the file path.\n\n---CONTENT START---\n${markdown}\n---CONTENT END---`;

  try {
    const resp = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        model_name: config.zoModel || undefined,
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `Zo API error: ${resp.status} ${resp.statusText}` };
    }
    const data = await resp.json();
    const output = data.output || '';
    return { ok: true, path: path, response: output };
  } catch (err) {
    return { ok: false, error: `Save failed: ${err.message}` };
  }
}

// Run a Zo skill on the current page (#04)
async function runSkill(skillName, pageContext) {
  const prompt = `Run the skill named "${skillName}" using the content from the current page as input.

Page URL: ${pageContext?.url || '(unknown)'}
Page title: ${pageContext?.title || '(unknown)'}

Page text (first 2000 chars):
${(pageContext?.visibleText || '').slice(0, 2000)}

Read the skill's SKILL.md and follow its instructions.`;
  try {
    const resp = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        model_name: config.zoModel || undefined,
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `Zo API error: ${resp.status} ${resp.statusText}` };
    }
    const data = await resp.json();
    return { ok: true, response: data.output || '' };
  } catch (err) {
    return { ok: false, error: `Skill run failed: ${err.message}` };
  }
}

// Create a scheduled automation from the current page (#08)
async function createAutomation(instruction, rrule, pageContext) {
  const prompt = `Create a scheduled automation with these parameters:
  - Instruction: ${instruction}
  - Schedule (RRULE): ${rrule || 'FREQ=DAILY'}
  - Source page URL: ${pageContext?.url || '(unknown)'}
  - Source page title: ${pageContext?.title || '(unknown)'}

Context from the page (first 1000 chars):
${(pageContext?.visibleText || '').slice(0, 1000)}

Use the create_agent tool to create this automation now.`;
  try {
    const resp = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        model_name: config.zoModel || undefined,
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `Zo API error: ${resp.status} ${resp.statusText}` };
    }
    const data = await resp.json();
    return { ok: true, response: data.output || '' };
  } catch (err) {
    return { ok: false, error: `Automation creation failed: ${err.message}` };
  }
}

// List existing automations (#08)
async function listAutomations() {
  const prompt = 'List all my automations. For each, return the title, schedule (RRULE), and delivery method.';
  try {
    const resp = await fetch(config.zoApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        model_name: config.zoModel || undefined,
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `Zo API error: ${resp.status} ${resp.statusText}` };
    }
    const data = await resp.json();
    return { ok: true, response: data.output || '' };
  } catch (err) {
    return { ok: false, error: `Failed to list automations: ${err.message}` };
  }
}

// Run a natural-language query against Zo's DuckDB datasets via zo.space (#05)
async function runDuckdbQuery(naturalQuery) {
  if (!config.zoAccessToken) {
    return { ok: false, error: 'Zo access token not configured.' };
  }
  const endpoint = config.zoSpaceEndpoint || 'https://cashlessconsumer.zo.space';
  try {
    const resp = await fetch(`${endpoint}/api/cobrowse/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.zoAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: naturalQuery }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, error: `DuckDB query failed: ${resp.status} ${resp.statusText}${txt ? ' — ' + txt : ''}` };
    }
    const data = await resp.json();
    // Expected shape from the API: { ok: true, columns: [...], rows: [[...], ...], sql: "..." }
    return {
      ok: true,
      columns: data.columns || [],
      rows: data.rows || [],
      sql: data.sql || '',
      rowCount: Array.isArray(data.rows) ? data.rows.length : 0,
    };
  } catch (err) {
    return { ok: false, error: `DuckDB query error: ${err.message}` };
  }
}

