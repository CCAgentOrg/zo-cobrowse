// Zo Co-browse — Side Panel Logic

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- Constants ----
const MAX_HISTORY = 50;
const OLD_STORAGE_KEY = 'cobrowse_history';
const STORAGE_CONVERSATIONS_KEY = 'cobrowse_convos';
const STORAGE_ACTIVE_KEY = 'cobrowse_active_id';

// ---- State ----
let config = { hasToken: false };
let conversations = {};     // all conversations keyed by id
let activeId = null;        // current conversation id
let pendingActions = null;
let currentContext = null;
let actionRunning = false;
let isHistoryView = false;

// ---- DOM refs ----
const msgsEl = $('#messages');
const input = $('#query-input');
const sendBtn = $('#send-btn');
const statusDot = $('#status-dot');
const pageUrl = $('#page-url');
const modelSelect = $('#model-select');
const personaSelect = $('#persona-select');
const actionsBar = $('#actions-bar');
const actionsReasoning = $('#actions-reasoning');
const runAllBtn = $('#run-all-btn');
const skipBtn = $('#skip-btn');
const newChatBtn = $('#new-chat-btn');
const historyBtn = $('#history-btn');
const helpBtn = $('#help-btn');
const chatView = $('#chat-view');
const historyViewEl = $('#history-view');
const historyList = $('#history-list');
const backToChatBtn = $('#back-to-chat-btn');

// ---- Init ----
init();

async function init() {
  await loadConfig();
  updateStatus(config.hasToken);
  bindEvents();
  await refreshPageContext();
  await migrateOldFormat();
  await loadConversations();
  await fetchModelsAndPersonas();
  renderView();
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
  // Model/Persona selection — save to chrome.storage.sync so background picks it up
  modelSelect.addEventListener('change', () => {
    config.selectedModel = modelSelect.value;
    chrome.storage.sync.set({ zoModel: modelSelect.value });
  });
  personaSelect.addEventListener('change', () => {
    config.selectedPersona = personaSelect.value;
    chrome.storage.sync.set({ zoPersonaId: personaSelect.value });
  });

  // Send
  sendBtn.addEventListener('click', sendQuery);
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

  // New conversation
  newChatBtn.addEventListener('click', startNewConversation);

  // History toggle
  historyBtn.addEventListener('click', toggleHistoryView);
  backToChatBtn.addEventListener('click', toggleHistoryView);
  helpBtn.addEventListener('click', () => chrome.tabs.create({ url: 'ht' }));

  // Open settings on status dot double-click
  statusDot.addEventListener('dblclick', () => chrome.runtime.openOptionsPage());
}

// ---- View switching ----

function renderView() {
  if (isHistoryView) {
    renderHistoryView();
  } else {
    renderChatView();
  }
}

function renderChatView() {
  isHistoryView = false;
  historyViewEl.classList.add('hidden');
  chatView.classList.remove('hidden');
  historyBtn.classList.remove('active');
  historyBtn.title = 'History';
}

function toggleHistoryView() {
  // If switching to history, save current conversation first
  if (!isHistoryView) {
    saveCurrentConversation();
  }
  isHistoryView = !isHistoryView;
  renderView();
}

// ---- Multi-conversation storage ----

async function migrateOldFormat() {
  const result = await chrome.storage.local.get(OLD_STORAGE_KEY);
  const oldMessages = result[OLD_STORAGE_KEY];
  if (!oldMessages || !Array.isArray(oldMessages) || oldMessages.length === 0) return;

  // Create a conversation from the old flat history
  const id = generateId();
  const firstUserMsg = oldMessages.find(m => m.role === 'user');
  conversations[id] = {
    id,
    title: firstUserMsg ? firstUserMsg.text.substring(0, 60) : 'Previous session',
    createdAt: oldMessages[0]?.timestamp || Date.now(),
    updatedAt: Date.now(),
    messages: oldMessages,
  };
  activeId = id;

  await saveConversations();
  await chrome.storage.local.remove(OLD_STORAGE_KEY);
}

function generateId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

async function loadConversations() {
  const result = await chrome.storage.local.get([STORAGE_CONVERSATIONS_KEY, STORAGE_ACTIVE_KEY]);
  conversations = result[STORAGE_CONVERSATIONS_KEY] || {};
  activeId = result[STORAGE_ACTIVE_KEY] || null;

  // If no active conversation, create one
  if (!activeId || !conversations[activeId]) {
    createNewConversation();
  } else {
    renderCurrentConversation();
  }

  // Update history button badge
  updateHistoryBadge();
}

async function saveConversations() {
  await chrome.storage.local.set({
    [STORAGE_CONVERSATIONS_KEY]: conversations,
    [STORAGE_ACTIVE_KEY]: activeId,
  });
}

function getActiveConversation() {
  return conversations[activeId] || null;
}

function createNewConversation() {
  const id = generateId();
  conversations[id] = {
    id,
    title: 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  activeId = id;
  saveConversations();
}

async function saveCurrentConversation() {
  const conv = getActiveConversation();
  if (conv) {
    conv.updatedAt = Date.now();
    // Auto-title from first user message
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (firstUserMsg && conv.title === 'New Chat') {
      conv.title = firstUserMsg.text.substring(0, 60);
    }
    saveConversations();
  }
}

async function ensureActiveConversation() {
  const conv = getActiveConversation();
  if (!conv) {
    createNewConversation();
  }
}

function renderCurrentConversation() {
  msgsEl.innerHTML = '';
  const conv = getActiveConversation();
  if (!conv || !conv.messages.length) {
    addMessageDOM('system', 'Connected to Zo. Ask me about this page, or tell me what to do.');
    return;
  }
  for (const msg of conv.messages) {
    addMessageDOM(msg.role, msg.text);
  }
}

async function startNewConversation() {
  // Save current if it has messages
  const current = getActiveConversation();
  if (current && current.messages.length > 0) {
    saveCurrentConversation();
  }

  // Reset Zo conversation on the backend
  chrome.runtime.sendMessage({ type: 'NEW_CONVERSATION' });

  // Create new conversation
  createNewConversation();

  // Clear UI
  msgsEl.innerHTML = '';
  addMessageDOM('system', 'Connected to Zo. Ask me about this page, or tell me what to do.');

  // If in history view, switch back
  if (isHistoryView) {
    isHistoryView = false;
    renderView();
  }

  updateHistoryBadge();
}

async function switchToConversation(id) {
  if (id === activeId) return;

  // Save current conversation first
  saveCurrentConversation();

  // Switch
  activeId = id;
  await saveConversations();

  // Render
  msgsEl.innerHTML = '';
  const conv = getActiveConversation();
  if (conv && conv.messages.length > 0) {
    for (const msg of conv.messages) {
      addMessageDOM(msg.role, msg.text);
    }
  } else {
    addMessageDOM('system', 'Connected to Zo. Ask me about this page, or tell me what to do.');
  }

  // If in history view, switch back to chat
  if (isHistoryView) {
    isHistoryView = false;
    renderView();
  }
}

async function deleteConversation(id) {
  delete conversations[id];
  if (activeId === id) {
    // If deleting active, find another or create new
    const ids = Object.keys(conversations);
    if (ids.length > 0) {
      activeId = ids[0];
    } else {
      createNewConversation();
    }
  }
  await saveConversations();
  updateHistoryBadge();
  if (isHistoryView) {
    renderHistoryView();
  }
}

function listConversationSummaries() {
  return Object.values(conversations)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
      isActive: c.id === activeId,
    }));
}

function updateHistoryBadge() {
  const count = Object.keys(conversations).length;
  historyBtn.textContent = count > 1 ? `☰ ${count}` : '☰';
  historyBtn.title = count > 1 ? `History (${count} conversations)` : 'History';
}

// ---- History view ----

function renderHistoryView() {
  historyViewEl.classList.remove('hidden');
  chatView.classList.add('hidden');
  historyBtn.classList.add('active');

  const summaries = listConversationSummaries();
  historyList.innerHTML = '';

  if (summaries.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No past conversations yet.</div>';
    return;
  }

  // Group by date
  const groups = groupByDate(summaries);
  for (const [label, items] of Object.entries(groups)) {
    const groupEl = document.createElement('div');
    groupEl.className = 'history-group';

    const labelEl = document.createElement('div');
    labelEl.className = 'history-group-label';
    labelEl.textContent = label;
    groupEl.appendChild(labelEl);

    for (const item of items) {
      const card = document.createElement('div');
      card.className = `history-card${item.isActive ? ' history-card-active' : ''}`;
      card.dataset.convId = item.id;

      const titleEl = document.createElement('div');
      titleEl.className = 'history-card-title';
      titleEl.textContent = item.title;

      const metaEl = document.createElement('div');
      metaEl.className = 'history-card-meta';
      const timeStr = formatTime(item.updatedAt);
      metaEl.textContent = `${item.messageCount} msg · ${timeStr}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-card-delete';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete conversation';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this conversation?')) {
          deleteConversation(item.id);
        }
      });

      card.appendChild(titleEl);
      card.appendChild(metaEl);
      card.appendChild(deleteBtn);

      card.addEventListener('click', () => switchToConversation(item.id));

      groupEl.appendChild(card);
    }

    historyList.appendChild(groupEl);
  }
}

function groupByDate(summaries) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const thisWeek = today - now.getDay() * 86400000;
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const groups = {};
  for (const item of summaries) {
    let label;
    if (item.updatedAt >= today) label = 'Today';
    else if (item.updatedAt >= yesterday) label = 'Yesterday';
    else if (item.updatedAt >= thisWeek) label = 'This Week';
    else if (item.updatedAt >= thisMonth) label = 'This Month';
    else label = 'Older';
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

// ---- Fetch models and personas ----
async function fetchModelsAndPersonas() {
  // Restore saved selections from chrome.storage.sync
  const saved = await chrome.storage.sync.get(['zoModel', 'zoPersonaId']);
  if (saved.zoModel) config.selectedModel = saved.zoModel;
  if (saved.zoPersonaId) config.selectedPersona = saved.zoPersonaId;

  const modelsResp = await chrome.runtime.sendMessage({ type: 'LIST_MODELS' });
  if (modelsResp?.success && Array.isArray(modelsResp.models)) {
    modelSelect.innerHTML = '<option value="">Default model</option>';
    for (const m of modelsResp.models) {
      const opt = document.createElement('option');
      // API returns { model_name, label, vendor, type, ... }
      opt.value = m.model_name || m.id || '';
      opt.textContent = m.label || m.name || m.model_name || m.id;
      if (opt.value === config.selectedModel) opt.selected = true;
      modelSelect.appendChild(opt);
    }
  } else {
    modelSelect.innerHTML = '<option value="">Models unavailable</option>';
  }

  const personasResp = await chrome.runtime.sendMessage({ type: 'LIST_PERSONAS' });
  if (personasResp?.success && Array.isArray(personasResp.personas)) {
    personaSelect.innerHTML = '<option value="">Zo (default)</option>';
    for (const p of personasResp.personas) {
      const opt = document.createElement('option');
      opt.value = p.id || p.name || '';
      opt.textContent = p.name || p.id || '';
      if (opt.value === config.selectedPersona) opt.selected = true;
      personaSelect.appendChild(opt);
    }
  }
}

// ---- Send ----
async function sendQuery() {
  const query = input.value.trim();
  if (!query || actionRunning) return;
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  // Ensure we have an active conversation
  await ensureActiveConversation();

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
    modelName: config.selectedModel || undefined,
    personaId: config.selectedPersona || undefined,
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

  // Try to parse output — could be JSON or plain text
  const output = resp.output;
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
    await new Promise((r) => setTimeout(r, 600));
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
  addMessageDOM(role, text);
  // Persist non-system, non-thinking messages to current conversation
  if (role !== 'system' && role !== 'thinking') {
    const conv = getActiveConversation();
    if (conv) {
      conv.messages.push({ role, text, timestamp: Date.now() });
      // Trim to MAX_HISTORY per conversation
      if (conv.messages.length > MAX_HISTORY) {
        conv.messages = conv.messages.slice(-MAX_HISTORY);
      }
      saveCurrentConversation();
    }
  }
}

function addMessageDOM(role, text) {
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
