// Zo Co-browse — Background Service Worker
// Manages Zo API communication, settings, and message routing

const DEFAULTS = {
  zoApiUrl: 'https://api.zo.computer/zo/ask',
  zoModel: 'byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc',
  zoSpaceEndpoint: 'https://cashlessconsumer.zo.space',
};

let config = { ...DEFAULTS };

// ---- Init ----
chrome.storage.sync.get(
  ['zoApiUrl', 'zoAccessToken', 'zoModel', 'zoSpaceEndpoint'],
  (result) => {
    if (result.zoApiUrl) config.zoApiUrl = result.zoApiUrl;
    if (result.zoAccessToken) config.zoAccessToken = result.zoAccessToken;
    if (result.zoModel) config.zoModel = result.zoModel;
    if (result.zoSpaceEndpoint) config.zoSpaceEndpoint = result.zoSpaceEndpoint;
  }
);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.zoApiUrl?.newValue) config.zoApiUrl = changes.zoApiUrl.newValue;
  if (changes.zoAccessToken?.newValue) config.zoAccessToken = changes.zoAccessToken.newValue;
  if (changes.zoModel?.newValue) config.zoModel = changes.zoModel.newValue;
  if (changes.zoSpaceEndpoint?.newValue) config.zoSpaceEndpoint = changes.zoSpaceEndpoint.newValue;
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
      askZo(request.pageContext, request.userQuery).then(sendResponse);
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
  }
});

// ---- Core ----

function sanitizedConfig() {
  return {
    zoApiUrl: config.zoApiUrl,
    zoModel: config.zoModel,
    zoSpaceEndpoint: config.zoSpaceEndpoint,
    hasToken: !!config.zoAccessToken,
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

async function askZo(pageContext, userQuery) {
  if (!config.zoAccessToken) {
    return { error: '❌ Zo access token not configured. Open extension settings to set it up.' };
  }

  const prompt = `You are Zo — the user's AI co-browsing assistant. You see the page they're on and can control the browser.

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

## Instructions
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
        model_name: config.zoModel,
        // no output_format — prompted for raw JSON
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        error: `Zo API error: ${response.status}${body ? ' — ' + body.substring(0, 200) : ''}`,
      };
    }

    const data = await response.json();
    // data.output is a string — the model's markdown or JSON text
    return { success: true, output: data.output };
  } catch (err) {
    return { error: `Connection failed: ${err.message}` };
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
        model_name: config.zoModel,
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
    if (!tabId) return { error: 'No active tab' };
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
    if (action.type !== 'wait') await sleep(500);
  }
  return results;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
