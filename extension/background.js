// Zo Co-browse — Background Service Worker
// Manages Zo API communication, settings, and message routing

const DEFAULTS = {
  zoApiUrl: 'https://api.zo.computer/zo/ask',
  zoModel: '',
  zoSpaceEndpoint: 'https://cashlessconsumer.zo.space',
};

let config = { ...DEFAULTS };
// Track Zo API conversation ID for multi-turn context
let zoConversationId = null;

// ---- Init ----
chrome.storage.sync.get(
  ['zoApiUrl', 'zoModel', 'zoPersonaId'],
  (result) => {
    if (result.zoApiUrl) config.zoApiUrl = result.zoApiUrl;
    if (result.zoModel) config.zoModel = result.zoModel;
    if (result.zoPersonaId) config.zoPersonaId = result.zoPersonaId;
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

chrome.storage.onChanged.addListener((changes) => {
  if (changes.zoApiUrl?.newValue) config.zoApiUrl = changes.zoApiUrl.newValue;
  if (changes.zoAccessToken?.newValue) config.zoAccessToken = changes.zoAccessToken.newValue;
  else if (changes.zoAccessToken?.oldValue && !changes.zoAccessToken?.newValue) config.zoAccessToken = undefined;
  if (changes.zoModel?.newValue) config.zoModel = changes.zoModel.newValue;
  if (changes.zoSpaceEndpoint?.newValue) config.zoSpaceEndpoint = changes.zoSpaceEndpoint.newValue;
  else if (changes.zoSpaceEndpoint?.oldValue && !changes.zoSpaceEndpoint?.newValue) config.zoSpaceEndpoint = undefined;
  if (changes.zoPersonaId?.newValue) config.zoPersonaId = changes.zoPersonaId.newValue;
});

// Open side panel on toolbar icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ---- Message handler ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'GET_PAGE_CONTEXT': {
      getActiveTabContext(sender.tab?.id).then(sendResponse);
      return true;
    }
    case 'ASK_ZO': {
      askZo(request.pageContext, request.userQuery, request.modelName, request.personaId, request.presetSystemPrompt, request.presetInstructions).then(sendResponse);
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
    zoSpaceEndpoint: config.zoSpaceEndpoint,
    hasToken: !!config.zoAccessToken,
    zoConversationId: zoConversationId,
  };
}

// ---- Route context capture and action execution through content script ----

async function getActiveTabContext(tabId) {
  // Step 1: find the active tab
  let tab;
  if (tabId) {
    tab = { id: tabId };
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }
  if (!tab?.id) return { error: 'No active tab' };

  // Step 2: try content script first (more reliable, no host_permission needed)
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_CONTEXT' });
    if (resp && !resp.error) return resp;
  } catch {
    // content script not injected — fall through to executeScript
  }

  // Step 3: fallback — inject inline via scripting API
  try {
    const [context] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
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
      },
    });
    return context?.result || { error: 'Could not capture context' };
  } catch (err) {
    return { error: err.message };
  }
}

async function askZo(pageContext, userQuery, modelName, personaId, presetSystemPrompt, presetInstructions) {
  if (!config.zoAccessToken) {
    return { error: '❌ Zo access token not configured. Open extension settings to set it up.' };
  }

  // Use preset prompts or fall back to defaults
  const systemPrompt = presetSystemPrompt || `You are Zo — the user's AI co-browsing assistant. You see the page they're on and can control the browser.`;
  const instructions = presetInstructions || `## Instructions
Think step by step about what actions to take, then respond with a valid JSON object.

{
  "reasoning": "your step-by-step thinking",
  "actions": [
    {
      "type": "navigate" | "click" | "fill" | "extract" | "scroll" | "wait" | "done",
      // For navigate: { "url": "..." }
      // For click/extract: { "selector": "css-selector" }
      // For fill: { "selector": "css-selector", "value": "text to type" }
      // For extract: { "selector": "css-selector", "attribute": "textContent|href|src|..." }
      // For scroll: { "direction": "up"|"down", "amount": 300 }
      // For wait: { "ms": 1000 }
      // For done: { "response": "summary of what happened / answer for user" }
    }
  ]
}`;

  const prompt = `${systemPrompt}

## Current Page
- **URL:** ${pageContext.url}
- **Title:** ${pageContext.title}
- **Viewport:** ${pageContext.viewport?.w || '?'}x${pageContext.viewport?.h || '?'}

## Page Content (visible text)
\`\`\`
${(pageContext.visibleText || '—empty—').substring(0, 4000)}
\`\`\`

## Interactive Elements
${JSON.stringify(pageContext.formFields || [], null, 2)}

## User Request
${userQuery}

  ${instructions}`;

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
        ...((personaId || config.zoPersonaId) ? { persona_id: personaId || config.zoPersonaId } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        error: `Zo API error: ${response.status}${body ? ' — ' + body.substring(0, 200) : ''}`,
      };
    }

    const data = await response.json();
    // Persist Zo conversation ID for context in subsequent calls
    if (data.conversation_id) zoConversationId = data.conversation_id;
    // data.output is a string — the model's markdown or JSON text
    return { success: true, output: data.output };
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
