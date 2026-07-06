// Zo Co-browse — Background Service Worker
// Manages Zo API communication, settings, and message routing

const DEFAULTS = {
  zoApiUrl: 'https://api.zo.computer/zo/ask',
  zoModel: '',
  zoSpaceEndpoint: 'https://cashlessconsumer.zo.space',
  zoPersonaId: '',          // backward compat — overrides routing if set
  zoLitePersonaId: '',      // persona for lite (page-only) tasks
  zoFullPersonaId: '',      // persona for full (tool-enabled) tasks
  personaMode: 'auto',      // 'auto' | 'lite' | 'full'
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
  ['zoApiUrl', 'zoModel', 'zoPersonaId', 'zoLitePersonaId', 'zoFullPersonaId', 'personaMode'],
  (result) => {
    if (result.zoApiUrl) config.zoApiUrl = result.zoApiUrl;
    if (result.zoModel) config.zoModel = result.zoModel;
    if (result.zoPersonaId) config.zoPersonaId = result.zoPersonaId;
    if (result.zoLitePersonaId) config.zoLitePersonaId = result.zoLitePersonaId;
    if (result.zoFullPersonaId) config.zoFullPersonaId = result.zoFullPersonaId;
    if (result.personaMode) config.personaMode = result.personaMode;
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

  // Try content script first
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_CONTEXT', liteMode });
    if (resp && !resp.error) return resp;
  } catch {
    // content script not injected — fall through
  }

  // Fallback — inject inline
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
    const [context] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureFn,
    });
    return context?.result || { error: 'Could not capture context' };
  } catch (err) {
    return { error: err.message };
  }
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

  const prompt = `${systemPrompt}\n\n## Current Page\n- **URL:** ${pageContext.url}\n- **Title:** ${pageContext.title}\n- **Viewport:** ${pageContext.viewport?.w || '?'}x${pageContext.viewport?.h || '?'}\n\n## Page Content (visible text)\n\`\`\`\n${(pageContext.visibleText || '—empty—').substring(0, isLite ? 2000 : 4000)}\n\`\`\`\n${pageContext.formFields ? `\n## Interactive Elements\n${JSON.stringify(pageContext.formFields || [], null, 2)}\n` : ''}\n\n## User Request\n${userQuery}\n\n  ${instructions}`;

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
