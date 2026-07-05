// Zo Co-browse — Side Panel Logic

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- State ----
let config = { hasToken: false };
let conversation = [];
let pendingActions = null;
let currentContext = null;
let actionRunning = false;

// ---- DOM refs ----
const msgsEl = $('#messages');
const input = $('#query-input');
const sendBtn = $('#send-btn');
const statusDot = $('#status-dot');
const pageUrl = $('#page-url');
const actionsBar = $('#actions-bar');
const actionsReasoning = $('#actions-reasoning');
const runAllBtn = $('#run-all-btn');
const skipBtn = $('#skip-btn');

// ---- Init ----
init();

async function init() {
  await loadConfig();
  updateStatus(config.hasToken);
  bindEvents();
  await refreshPageContext();
}

async function loadConfig() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (resp) config = resp;
}

function updateStatus(connected) {
  statusDot.className = `dot ${connected ? 'dot-connected' : 'dot-disconnected'}`;
  statusDot.title = connected ? 'Zo connected' : 'Not configured — open settings';
}

function bindEvents() {
  // Send
  sendBtn.addEventListener('click', sendQuery);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); }
  });

  // Chips
  $$('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.action;
      sendQuery();
    });
  });

  // Pending actions
  runAllBtn.addEventListener('click', runPendingActions);
  skipBtn.addEventListener('click', () => { pendingActions = null; actionsBar.classList.add('hidden'); });

  // Open settings on status dot double-click
  statusDot.addEventListener('dblclick', () => chrome.runtime.openOptionsPage());
}

// ---- Page Context ----
async function refreshPageContext() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
  if (resp && !resp.error) {
    currentContext = resp;
    pageUrl.textContent = resp.title || resp.url;
    pageUrl.title = resp.url;
  } else {
    pageUrl.textContent = '— no page —';
    currentContext = null;
  }
}

// ---- Send ----
async function sendQuery() {
  const query = input.value.trim();
  if (!query || actionRunning) return;
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  // If no page context, try again
  await refreshPageContext();
  if (!currentContext) {
    addMessage('error', 'Could not capture page context. Try loading a webpage first.');
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }

  if (!config.hasToken) {
    addMessage('error', 'Zo not configured. Open extension settings to add your access token.');
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }

  addMessage('user', query);
  addMessage('thinking', 'Zo is thinking...');

  const resp = await chrome.runtime.sendMessage({
    type: 'ASK_ZO',
    pageContext: currentContext,
    userQuery: query,
  });

  // Remove thinking indicator
  const thinking = msgsEl.querySelector('.msg-thinking');
  if (thinking) thinking.remove();

  if (resp.error) {
    addMessage('error', resp.error);
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }

  const output = resp.output;
  const reasoning = output?.reasoning || '';
  const actions = output?.actions || [];

  if (!actions.length) {
    addMessage('assistant', reasoning || 'Done.');
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }

  // Show reasoning + pending actions
  const navigateActions = actions.filter((a) => a.type === 'navigate');
  const domActions = actions.filter((a) => a.type !== 'navigate' && a.type !== 'done');
  const doneResponse = actions.find((a) => a.type === 'done')?.response;

  if (navigateActions.length) {
    addMessage('assistant', `📍 Navigating to: ${navigateActions[0].url}`);
    await chrome.runtime.sendMessage({
      type: 'NAVIGATE',
      url: navigateActions[0].url,
    });
    // Wait for page to load, then recapture context
    setTimeout(async () => {
      await refreshPageContext();
      if (doneResponse) addMessage('assistant', doneResponse);
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }, 2000);
    return;
  }

  if (domActions.length) {
    pendingActions = domActions;
    actionsReasoning.textContent = `🧠 ${reasoning.substring(0, 200)}`;
    actionsBar.classList.remove('hidden');
    addMessage('assistant', `🧠 ${reasoning} ${doneResponse ? '\n\n' + doneResponse : ''}`);
    // Auto-run by default
    runPendingActions();
  } else if (doneResponse) {
    addMessage('assistant', doneResponse);
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

// ---- Execute pending actions ----
async function runPendingActions() {
  if (!pendingActions || actionRunning) return;
  actionRunning = true;
  runAllBtn.disabled = true;
  skipBtn.disabled = true;

  // Get current tab id
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (!tabId) {
    addMessage('error', 'No active tab to execute actions on.');
    actionRunning = false;
    runAllBtn.disabled = false;
    skipBtn.disabled = false;
    return;
  }

  for (const action of pendingActions) {
    if (action.type === 'done') {
      addMessage('assistant', action.response || 'Done.');
      break;
    }
    addMessage('action', `${action.type}: ${action.selector || action.url || action.value || ''}`);
    const result = await chrome.runtime.sendMessage({
      type: 'EXECUTE_ACTIONS',
      actions: [action],
      tabId,
    });
    if (!result?.ok) {
      addMessage('error', `Action failed: ${result?.error || 'unknown error'}`);
      break;
    }
    // Wait a beat for page mutations
    await new Promise((r) => setTimeout(r, 600));
    // Refresh context after each action
    await refreshPageContext();
  }

  pendingActions = null;
  actionsBar.classList.add('hidden');
  actionRunning = false;
  runAllBtn.disabled = false;
  skipBtn.disabled = false;
}

// ---- Messages ----
function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  div.appendChild(body);
  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return div;
}
