async function askZoStream(port, msg) {
  const maxRetries = 3;
  const baseDelay = 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries });
      return await _askZoStreamImpl(port, msg);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
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
    fillField: true,
  },
};

let config = { ...DEFAULTS };
// Track Zo API conversation ID for multi-turn context
let zoConversationId = null;

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
  ['zoApiUrl', 'zoModel', 'zoPersonaId', 'zoLitePersonaId', 'zoFullPersonaId', 'personaMode', 'enableScreenshots'],
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

// Open side panel on toolbar icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

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
      chrome.tabs.update(request.tabId || sender.tab?.id, { url: request.url }).then(() =>
        sendResponse({ ok: true })
      );
      return true;
    }
    case 'EXECUTE_CONTENT_SCRIPT': {
      chrome.scripting
        .executeScript({
          target: { tabId: request.tabId || sender.tab?.id },
          func: request.func,
          args: request.args || [],
        })
        .then(([result]) => sendResponse({ ok: true, result: result.result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
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
      createAutomation(request.pageContext, request.trigger, request.action).then(sendResponse);
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

async function getActiveTabContext(tabId, liteMode) {
  let tab;
  if (tabId) {
    tab = { id: tabId };
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }
  if (!tab?.id) return { error: 'No active tab' };

  let context;

  // Try content script first
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_CONTEXT', liteMode });
    if (resp && !resp.error) context = resp;
  } catch {
    // content script not injected — fall through
  }

  // Fallback — inject inline
  if (!context) {
    try {
      const captureFn = liteMode
        ? () => {
            const text = document.body?.innerText || '';
            return {
              url: location.href,
              title: document.title,
              visibleText: text.substring(0, 2000), // lighter capture
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
              formFields.push({
                tag: el.tagName.toLowerCase(),
                type: el.type || 'text',
                name: el.name || el.id || '',
                placeholder: el.placeholder || '',
              });
            });
            return {
              url: location.href,
              title: document.title,
              visibleText: text.substring(0, 8000),
              formFields: formFields.slice(0, 30),
              viewport: { w: window.innerWidth, h: window.innerHeight },
            };
          };
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: captureFn,
      });
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
      // Screenshot not available — continue without it
      console.log('Screenshot capture skipped:', e.message);
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

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      case 'ASK_ZO': {
        await askZoStream(port, msg);
        break;
      }
      case 'NEW_CONVERSATION': {
        zoConversationId = null;
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
    await chrome.storage.session.set({ pendingZoQuery: { text: query, source: contextType, context: pageContext } });
    // Broadcast to sidepanel if already open — also clear so subsequent init checks don't re-fire
    chrome.runtime.sendMessage({ type: 'PENDING_ZO_QUERY', text: query, source: contextType }).catch(() => {});
  } catch (err) {
    console.error('Context menu error:', err);
  }
});

// Re-create menus on install and browser start
chrome.runtime.onInstalled.addListener(() => recreateContextMenus());
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
  // Retry loop with exponential backoff
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 2), 8000);
      console.log(`[Zo Co-browse] Retrying (#${attempt}/${MAX_RETRIES}) after ${delay}ms`);
      port.postMessage({ type: 'STREAM_RECONNECT', attempt, maxRetries: MAX_RETRIES, delay });
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      await _askZoStreamImpl(port, msg);
      return; // success — done
    } catch (err) {
      lastError = err;
      console.error(`[Zo Co-browse] askZoStream attempt ${attempt} failed:`, err);
      // Only retry on network-type errors, not logic errors
      if (!err.message || (
        !err.message.includes('fetch') &&
        !err.message.includes('network') &&
        !err.message.includes('ERR_CONNECTION') &&
        !err.message.includes('ERR_SSL') &&
        !err.message.includes('timeout') &&
        !err.message.includes('abort')
      )) {
        throw err; // not retryable — propagate immediately
      }
    }
  }

  // All retries exhausted — send final error
  port.postMessage({
    type: 'STREAM_ERROR',
    error: `Connection failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`,
  });
}

async function _askZoStreamImpl(port, msg) {
  const { pageContext, userQuery, modelName, personaId, presetSystemPrompt, presetInstructions, intent } = msg;

  if (!config.zoAccessToken) {
    port.postMessage({ type: 'STREAM_ERROR', error: '❌ Zo access token not configured. Open extension settings to set it up.' });
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
      port.postMessage({
        type: 'STREAM_ERROR',
        error: `Zo API error: ${response.status}${body ? ' — ' + body.substring(0, 200) : ''}`,
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          // Capture conversation_id from any event
          const convMatch = trimmed.match(/"conversation_id"\s*:\s*"([^"]+)"/);
          if (convMatch) zoConversationId = convMatch[1];

          const data = trimmed.slice(6).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.content || parsed.text || parsed.delta || parsed.response || '';
            if (content) {
              fullText += content;
              port.postMessage({ type: 'STREAM_CHUNK', text: fullText });
            }
            if (parsed.done || parsed.finish_reason || parsed.type === 'final' || parsed.type === 'complete') {
              if (parsed.output) fullText = parsed.output;
              if (parsed.conversation_id) zoConversationId = parsed.conversation_id;
              finishStream(port, fullText, resolvedIntent);
              return;
            }
          } catch {
            // Plain text SSE
            if (data === '[DONE]') {
              finishStream(port, fullText, resolvedIntent);
              return;
            }
            fullText += data;
            port.postMessage({ type: 'STREAM_CHUNK', text: fullText });
          }
        }
      }
    }

    // Stream ended
    finishStream(port, fullText, resolvedIntent);
  } catch (err) {
    port.postMessage({ type: 'STREAM_ERROR', error: `Connection failed: ${err.message}` });
  }
}

function finishStream(port, output, intent) {
  let reasoning = '';
  let actions = [];

  if (typeof output === 'object' && output !== null) {
    reasoning = output.reasoning || '';
    actions = output.actions || [];
  } else if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === 'object') {
        reasoning = parsed.reasoning || '';
        actions = parsed.actions || [];
      }
    } catch {
      reasoning = output;
    }
  }

  port.postMessage({
    type: 'STREAM_DONE',
    reasoning,
    actions,
    fullText: typeof output === 'string' ? output : JSON.stringify(output),
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
    if (data.conversation_id) zoConversationId = data.conversation_id;
    return { success: true, output: data.output, intent: resolvedIntent };
  } catch (err) {
    return { error: `Connection failed: ${err.message}` };
  }
}

async function listModels() {
  if (!config.zoAccessToken) return { error: 'No token' };
  try {
    const r = await fetch('https://api.zo.computer/models/available', {
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
    const r = await fetch('https://api.zo.computer/personas/available', {
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
    zoOk = body.includes('ZO_OK');
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
    // Try content script first
    let result;
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_ACTION',
        action,
      });
      result = resp || { ok: false, error: 'no response' };
    } catch {
      // Content script not loaded — fallback to executeScript
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: executeDomAction,
          args: [action],
        });
        result = r.result;
      } catch (err) {
        result = { ok: false, error: err.message };
      }
    }
    results.push(result);
    if (!result?.ok) break; // stop on first failure
    if (action.type !== 'wait') await sleep(500);
  }
  // Wrap in object so callers can check result.ok
  const allOk = results.every(r => r?.ok);
  const failed = results.find(r => !r?.ok);
  return allOk
    ? { ok: true, results }
    : { ok: false, results, error: failed?.error || 'Action failed' };
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
    const resp = await fetch(`${config.zoApiUrl}/zo/ask`, {
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
    const resp = await fetch(`${config.zoApiUrl}/zo/ask`, {
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
    const resp = await fetch(`${config.zoApiUrl}/zo/ask`, {
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
    const resp = await fetch(`${config.zoApiUrl}/zo/ask`, {
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

