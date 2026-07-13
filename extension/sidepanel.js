// Zo Co-browse — Side Panel Logic

import { parseBangCommand, BANG_COMMANDS } from './lib/bang-commands.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- Constants ----
const MAX_HISTORY = 50;
const OLD_STORAGE_KEY = 'cobrowse_history';
const STORAGE_CONVERSATIONS_KEY = 'cobrowse_convos';
const STORAGE_ACTIVE_KEY = 'cobrowse_active_id';
const STORAGE_PRESETS_KEY = 'cobrowse_presets';
const STORAGE_ACTIONS_KEY = 'zoQuickActions';

// ---- Theme ----
const THEME_STORAGE_KEY = 'cobrowse_theme';
let currentTheme = '';

const THEMES = {
  '':      { name: 'System',   icon: '◐', label: 'Follow system' },
  'dark':  { name: 'Dark',     icon: '☾', label: 'Midnight Observatory' },
  'light': { name: 'Light',    icon: '☀', label: 'Sunlit Observatory' },
  'sepia': { name: 'Sepia',    icon: '♨', label: 'Warm Paper' },
  'forest':{ name: 'Forest',   icon: '♣', label: 'Deep Grove' },
  'ocean': { name: 'Ocean',    icon: '⊡', label: 'Deep Water' },
};

async function loadTheme() {
  const saved = await chrome.storage.sync.get(THEME_STORAGE_KEY);
  currentTheme = saved[THEME_STORAGE_KEY] || '';
  applyTheme(currentTheme, true);
}

function applyTheme(theme, skipPersist) {
  currentTheme = theme;
  const effective = theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', effective);
  const btn = document.getElementById('theme-toggle');
  const info = THEMES[theme] || THEMES[''];
  if (btn) btn.textContent = info.icon;
  if (!skipPersist) chrome.storage.sync.set({ [THEME_STORAGE_KEY]: theme });
}

function showThemePopover() {
  let popover = document.getElementById('theme-popover');
  if (!popover) {
    popover = document.createElement('div');
    popover.id = 'theme-popover';
    popover.className = 'theme-popover';
    const themeKeys = ['', 'dark', 'light', 'sepia', 'forest', 'ocean'];
    for (const key of themeKeys) {
      const t = THEMES[key];
      const opt = document.createElement('button');
      opt.className = `theme-option${key === currentTheme ? ' selected' : ''}`;
      opt.dataset.theme = key;
      opt.innerHTML = `<div class="theme-swatch ${key || 'system'}"></div><span class="theme-label">${t.icon} ${t.name}</span>`;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTheme(key);
        closeThemePopover();
      });
      popover.appendChild(opt);
    }
    document.getElementById('theme-toggle').parentElement.appendChild(popover);
  }
  popover.classList.add('open');
  document.addEventListener('click', closeThemePopoverOutside, true);
}

function closeThemePopover() {
  const popover = document.getElementById('theme-popover');
  if (popover) popover.classList.remove('open');
  document.removeEventListener('click', closeThemePopoverOutside, true);
}

function closeThemePopoverOutside(e) {
  const popover = document.getElementById('theme-popover');
  const btn = document.getElementById('theme-toggle');
  if (popover && !popover.contains(e.target) && e.target !== btn) {
    closeThemePopover();
  }
}

// ---- Quick Actions (user-manageable chips) ----
const DEFAULT_QUICK_ACTIONS = [
  { label: 'Summarize', prompt: 'Summarize this page in 3-5 bullet points.' },
  { label: 'Extract links', prompt: 'Extract all links from this page.' },
  { label: 'Fill forms', prompt: 'Identify all form fields on this page and fill them with relevant test data.' },
  { label: 'Page data', prompt: 'Extract all structured data (tables, lists, prices, dates, contacts) from this page.' },
];

// ---- State ----
let config = { hasToken: false };
let conversations = {};     // all conversations keyed by id
let activeId = null;        // current conversation id
let pendingActions = null;
let currentContext = null;
let actionRunning = false;
let isHistoryView = false;

// ---- Streaming state ----
let zoPort = null;
let streamSessionId = 0;
let streamActive = false;
let streamMsgEl = null;
let streamAccumulated = '';

// ---- STT state ----
let recognition = null;
let isRecording = false;
let sttInterim = '';
let sttLang = 'en-US';

// ---- TTS state ----
let ttsAutoRead = false;
let ttsRate = 1.0;
let ttsVoice = '';
let ttsLang = 'en-US';
let isSpeaking = false;
let currentTtsBtnEl = null;

// ---- DOM refs ----
const msgsEl = $('#messages');
const input = $('#query-input');
const sendBtn = $('#send-btn');
const micBtn = $('#mic-btn');
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
const presetSelect = $('#preset-select');
const createPresetBtn = $('#create-preset-btn');

// ---- Presets ----
// Built-in presets
const BUILTIN_PRESETS = {
  research: {
    name: 'Research Deep-dive',
    description: 'Deep research on a topic — extract facts, data, and sources from the page',
    systemPrompt: "You are Zo — the user's AI research assistant. Your job is to deeply analyze the current page, extract key facts, data points, sources, and insights. Be thorough and cite specific content from the page.",
    instructions: `## Instructions
Analyze the page content in depth. Extract: key claims, data/statistics, named entities, sources cited, dates, and any contradictions. Organize your response with clear headings.

Respond with a valid JSON object:
{
  "reasoning": "your analysis process",
  "actions": [
    { "type": "extract", "selector": "body", "attribute": "textContent" },
    { "type": "done", "response": "structured findings markdown" }
  ]
}`
  },
  summarize: {
    name: 'Summarizer',
    description: 'Condense the page into a concise, scannable summary',
    systemPrompt: "You are Zo — the user's summarization assistant. Condense the page into its essential points. Be concise, objective, and organized.",
    instructions: `## Instructions
Produce a concise summary in 3-5 bullet points or a short paragraph. Capture the main argument, key evidence, and conclusion. No fluff.

Respond with a valid JSON object:
{
  "reasoning": "what the page is about",
  "actions": [
    { "type": "done", "response": "your summary here" }
  ]
}`
  },
  qa: {
    name: 'Q&A',
    description: 'Answer specific questions about the page content',
    systemPrompt: "You are Zo — answering questions about the current page. Base your answers strictly on page content. When the information is not on the page, say so clearly.",
    instructions: `## Instructions
Answer the user's question using only content visible on the current page. If the answer isn't on the page, state that clearly. Quote relevant passages when helpful.

Respond with a valid JSON object:
{
  "reasoning": "how you found the answer",
  "actions": [
    { "type": "done", "response": "your answer here" }
  ]
}`
  },
  scrape: {
    name: 'Data Extraction',
    description: 'Extract structured data (tables, lists, contacts, prices) from the page',
    systemPrompt: "You are Zo — the user's data extraction assistant. Extract structured data from the current page. Output clean, machine-readable data in tables or JSON format.",
    instructions: `## Instructions
Extract all structured data from the page: tables, lists, contact info, prices, dates, links. Format as markdown tables or JSON where appropriate. Be exhaustive — include everything.

Respond with a valid JSON object:
{
  "reasoning": "what data was found",
  "actions": [
    { "type": "extract", "selector": "table, ul, ol, dl", "attribute": "textContent" },
    { "type": "done", "response": "structured data output" }
  ]
}`
  }
};

let customPresets = {};
let activePreset = null;


// ---- Init ----
init();

async function init() {
  await loadConfig();
  await loadTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => loadTheme());
  updateStatus(config.hasToken);
  const { [OB_KEY]: obDone = false } = await chrome.storage.sync.get(OB_KEY);
  if (!obDone) { showOnboarding(); return; }
  bindEvents();
  await refreshPageContext();
  await checkPendingQuery(); // ← NEW: pick up query from context menu click
  await migrateOldFormat();
  await loadConversations();
  await fetchModelsAndPersonas();
  await loadPresets();
  await loadQuickActions();
  await loadTtsConfig();
  // Open streaming port to background — enables streaming Zo responses
  connectStreamingPort();
  // Re-render quick actions when they change in another view (e.g. Options)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_ACTIONS_KEY]) {
      const actions = changes[STORAGE_ACTIONS_KEY].newValue;
      renderQuickActions(actions || []);
    }
  });
  // Listen for context menu broadcasts when sidepanel is already open
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PENDING_ZO_QUERY' && msg.text) {
      input.value = msg.text;
      sendQuery();
    }
  });
  renderView();
}

/** Check if a context menu click stored a pending query */
async function checkPendingQuery() {
  try {
    // Retry a few times to handle race with background writing storage
    let pending = null;
    for (let i = 0; i < 5; i++) {
      const result = await chrome.storage.session.get('pendingZoQuery');
      pending = result.pendingZoQuery;
      if (pending) break;
      await new Promise(r => setTimeout(r, 300));
    }
    if (!pending) return;
    await chrome.storage.session.remove('pendingZoQuery');
    input.value = pending.text;
    currentContext = pending.context;
    // Automatically fire the query
    await sendQuery();
  } catch (e) {
    console.warn('checkPendingQuery failed:', e);
  }
}

async function loadConfig() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (resp) config = resp;
  // Also load personaMode directly from storage for sync
  const saved = await chrome.storage.sync.get(['personaMode', 'zoPersonaId']);
  if (saved.personaMode) config.personaMode = saved.personaMode;
  if (saved.zoPersonaId) config.selectedPersona = saved.zoPersonaId;
  updateRoutingBadge();
}

// ---- Onboarding ----

const OB_KEY = 'cobrowse_onboarding_done';
const OB_STEP_KEY = 'cobrowse_onboarding_step';

const OB_STEPS = [
  {
    title: 'Welcome to Zo Co-browse',
    desc: 'Your browser, supercharged with AI.',
    body: '<p>Zo Co-browse connects your browser to Zo Computer — your personal AI server. Zo can see what\'s on the page, answer questions, fill forms, extract data, run DuckDB queries, and even create automations — all from this side panel.</p><p>Let\'s get you set up in 30 seconds.</p>',
  },
  {
    title: 'Connect Your Zo',
    desc: 'You need a Zo Computer account to use Co-browse.',
    body: '<p>If you haven\'t already, sign up at <a href="https://zocomputer.com" target="_blank">zocomputer.com</a> — it\'s free.</p><p>Already have an account? Great — the next step is to add your API token.</p>',
  },
  {
    title: 'Add Your API Token',
    desc: 'This connects the extension to your Zo.',
    body: '<ol style="text-align:left;margin:0 auto;max-width:340px;line-height:1.8"><li>Open your Zo <strong>Settings → Advanced → Access Tokens</strong></li><li>Create a new token (or copy an existing one)</li><li>Paste it in the <strong>extension settings</strong> (gear icon below)</li></ol><p style="margin-top:12px">💡 Your token is stored locally and never shared.</p>',
  },
  {
    title: 'Test Your Connection',
    desc: 'Let\'s make sure everything works.',
    body: '<p>Click <strong>Test Connection</strong> below, or open the extension settings and hit "Test Connection" there.</p><p>If it works, you\'re all set! You can ask Zo anything about the page you\'re on.</p>',
    final: true,
  },
];

async function showOnboarding() {
  const chatView = document.getElementById('chat-view');
  const obView = document.getElementById('onboarding-view');
  if (!obView) return;
  chatView.classList.add('hidden');
  obView.classList.remove('hidden');

  const { [OB_STEP_KEY]: step = 0 } = await chrome.storage.sync.get(OB_STEP_KEY);
  renderOnboardingStep(step);
}

function renderOnboardingStep(step) {
  const s = OB_STEPS[step];
  if (!s) { completeOnboarding(); return; }
  document.getElementById('ob-title').textContent = s.title;
  document.getElementById('ob-desc').textContent = s.desc;
  document.getElementById('ob-body').innerHTML = s.body;

  const backBtn = document.getElementById('ob-back');
  const nextBtn = document.getElementById('ob-next');
  backBtn.classList.toggle('hidden', step === 0);
  nextBtn.textContent = s.final ? '🚀 Get Started' : 'Next →';

  const stepsEl = document.getElementById('ob-steps');
  stepsEl.innerHTML = OB_STEPS.map((_, i) =>
    `<span class="ob-dot${i === step ? ' ob-dot-active' : ''}${i < step ? ' ob-dot-done' : ''}"></span>`
  ).join('');

  chrome.storage.sync.set({ [OB_STEP_KEY]: step });
}

function handleOnboardingNext() {
  chrome.storage.sync.get(OB_STEP_KEY, ({ [OB_STEP_KEY]: s }) => {
    const next = (s || 0) + 1;
    if (next >= OB_STEPS.length) {
      completeOnboarding();
    } else {
      renderOnboardingStep(next);
    }
  });
}

function handleOnboardingBack() {
  chrome.storage.sync.get(OB_STEP_KEY, ({ [OB_STEP_KEY]: s }) => {
    if ((s || 0) > 0) renderOnboardingStep(s - 1);
  });
}

async function completeOnboarding() {
  await chrome.storage.sync.set({ [OB_KEY]: true, [OB_STEP_KEY]: 0 });
  document.getElementById('onboarding-view').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  addSystemMessage('🎉 Onboarding complete! Try asking Zo something about this page.');
}
const MODE_LABELS = {
  auto: '◐ Auto',
  lite: '☾ Lite',
  full: '⚡ Full',
};

const MODE_CYCLE = ['auto', 'lite', 'full'];

function updateRoutingBadge() {
  const badge = document.getElementById('routing-badge');
  if (!badge) return;
  const mode = config.personaMode || 'auto';
  badge.textContent = MODE_LABELS[mode] || '◐ Auto';
  badge.className = 'routing-badge ' + mode;
}

function cyclePersonaMode() {
  const current = config.personaMode || 'auto';
  const idx = MODE_CYCLE.indexOf(current);
  const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
  config.personaMode = next;
  chrome.storage.sync.set({ personaMode: next });
  updateRoutingBadge();
  // Show system message
  const msg = next === 'auto' ? '◐ Auto mode — Zo classifies each query as Lite or Full'
    : next === 'lite' ? '☾ Lite mode — page-only, no tool access'
    : '⚡ Full mode — Zo has full access to files, data, skills';
  addSystemMessage(`🔄 Persona: ${msg}`);
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
  sendBtn.addEventListener('click', () => { sendQuery(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); }
  });

  // Mic button — STT
  if (micBtn) {
    micBtn.addEventListener('click', () => { startRecording(); });
  }

  // Routing badge — click to cycle persona mode
  const routingBadge = document.getElementById('routing-badge');
  if (routingBadge) {
    routingBadge.addEventListener('click', () => {
      cyclePersonaMode();
    });
  }

  // Chips (event delegation for dynamically rendered chips)
  const chipsContainer = $('#action-chips');
  if (chipsContainer) {
    chipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        input.value = chip.textContent.trim();
        sendQuery();
      }
    });
  }

  // Preset selection
  presetSelect.addEventListener('change', applyPreset);
  createPresetBtn.addEventListener('click', startPresetCreation);

  // Theme toggle
  const themeToggle = $('#theme-toggle');
  if (themeToggle) themeToggle.addEventListener('click', showThemePopover);

  // Pending actions
  runAllBtn.addEventListener('click', runPendingActions);
  skipBtn.addEventListener('click', () => { pendingActions = null; actionsBar.classList.add('hidden'); });

  // New conversation
  newChatBtn.addEventListener('click', startNewConversation);

  // History toggle
  historyBtn.addEventListener('click', toggleHistoryView);
  backToChatBtn.addEventListener('click', toggleHistoryView);
  helpBtn.addEventListener('click', () => chrome.tabs.create({ url: 'https://cashlessconsumer.zo.space/co-browse' }));

  // Open settings on status dot double-click
  statusDot.addEventListener('dblclick', () => chrome.runtime.openOptionsPage());

  // Onboarding navigation
  const obNext = $('#ob-next');
  const obBack = $('#ob-back');
  const obSkip = $('#ob-skip');
  if (obNext) obNext.addEventListener('click', onboardingNext);
  if (obBack) obBack.addEventListener('click', onboardingBack);
  if (obSkip) obSkip.addEventListener('click', skipOnboarding);
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
  // Cancel any active stream
  cancelStream();
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
  // Cancel any active stream
  cancelStream();
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

// ---- Bang Commands (!) — Quick Command Templates (#07) ----
// Logic extracted to lib/bang-commands.js for unit testing (see tests/bang-commands.test.ts).

// Render a DuckDB query result as an inline table in the chat.
// Expects { columns: string[], rows: any[][], rowCount, sql } from background.js
function addDuckdbResult(resp) {
  if (!resp.columns || !resp.rows) {
    addMessage('assistant', 'Query returned no rows.');
    return;
  }
  const msg = document.createElement('div');
  msg.className = 'msg msg-assistant duckdb-result';
  const table = renderTable(resp.columns, resp.rows);
  msg.innerHTML = `<div class="db-sql"><code>${escapeHtml(resp.sql || '')}</code></div>${table}`;
  msgsEl.appendChild(msg);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// Build an HTML table string from columns + rows.
function renderTable(columns, rows) {
  const thead = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const tbody = rows.map(r =>
    `<tr>${r.map(cell => `<td>${escapeHtml(cell == null ? '' : String(cell))}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="db-table-wrap"><table class="db-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

// Parse bang commands (!) — #07 Quick Command Templates
const bang = parseBangCommand(query);
let effectiveQuery = query;
let tempPreset = null;
if (bang.handled) {
  if (bang.inlineReply) {
    // Inline reply (e.g. !help, !save, unknown) — no Zo call
    addMessage('user', query);
    addMessage('bot', bang.inlineReply);
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }
  if (bang.isSave) {
    // !save — send page to Zo to save in workspace as markdown
    addMessage('user', query);
    addMessage('thinking', 'Saving to workspace...');
    const saveResp = await chrome.runtime.sendMessage({
      type: 'SAVE_PAGE',
      pageContext: currentContext,
      savePath: bang.savePath || '',
    });
    const thinking = msgsEl.querySelector('.msg-thinking');
    if (thinking) thinking.remove();
    if (saveResp.error) {
      addMessage('error', saveResp.error);
    } else {
      addMessage('assistant', saveResp.response || 'Page saved to workspace.');
    }
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }
  if (bang.isAuto) {
    // !auto — create a persistent Zo automation from the page
    addMessage('user', query);
    addMessage('thinking', 'Creating automation...');
    const autoResp = await chrome.runtime.sendMessage({
      type: 'CREATE_AUTOMATION',
      instruction: bang.instruction || '',
      pageContext: currentContext,
    });
    const thinking2 = msgsEl.querySelector('.msg-thinking');
    if (thinking2) thinking2.remove();
    if (autoResp.error) {
      addMessage('error', autoResp.error);
    } else {
      addMessage('assistant', autoResp.response || 'Automation created.');
    }
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }
  if (bang.isDuckdb) {
    // !query / !data — natural-language DuckDB query
    addMessage('user', query);
    addMessage('thinking', 'Querying datasets...');
    const dbResp = await chrome.runtime.sendMessage({
      type: 'DUCKDB_QUERY',
      naturalQuery: bang.naturalQuery,
    });
    const thinking = msgsEl.querySelector('.msg-thinking');
    if (thinking) thinking.remove();
    if (dbResp.error) {
      addMessage('error', dbResp.error);
    } else {
      addDuckdbResult(dbResp);
    }
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }
  effectiveQuery = bang.query;
  tempPreset = bang.preset;
}

addMessage('user', query);  addMessage('user', query);
  addMessage('thinking', 'Zo is thinking...');

  // Determine preset prompts
  let presetSystemPrompt, presetInstructions;
  const effectivePreset = tempPreset || activePreset;
  if (effectivePreset) {
    const preset = getPreset(effectivePreset);
    if (preset) {
      presetSystemPrompt = preset.systemPrompt;
      presetInstructions = preset.instructions;
    }
  }

  const resp = await chrome.runtime.sendMessage({
    type: 'ASK_ZO',
    pageContext: currentContext,
    userQuery: effectiveQuery,
    modelName: config.selectedModel || undefined,
    personaId: config.selectedPersona || undefined,
    presetSystemPrompt: presetSystemPrompt,
    presetInstructions: presetInstructions,
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

// ---- Action Timeline (#03) ----
const ACTION_META = {
  click:    { icon: '👆', label: 'Click' },
  fill:     { icon: '✏️', label: 'Fill' },
  scroll:   { icon: '📜', label: 'Scroll' },
  navigate: { icon: '🔗', label: 'Navigate' },
  extract:  { icon: '📋', label: 'Extract' },
  wait:     { icon: '⏳', label: 'Wait' },
  done:     { icon: '✅', label: 'Done' },
};

function actionDetail(action) {
  if (action.response) return '';
  return action.selector || action.url || action.value || action.ms || '';
}

function renderActionTimeline() {
  if (!pendingActions) return;
  let timeline = actionsBar.querySelector('#action-timeline');
  if (!timeline) {
    timeline = document.createElement('div');
    timeline.id = 'action-timeline';
    actionsBar.appendChild(timeline);
  }
  timeline.innerHTML = '';
  pendingActions.forEach((action, i) => {
    const meta = ACTION_META[action.type] || { icon: '•', label: action.type };
    const card = document.createElement('div');
    card.className = 'action-card pending';
    card.dataset.index = i;
    card.innerHTML = `
      <span class="action-icon">${meta.icon}</span>
      <span class="action-label">${meta.label}</span>
      <span class="action-detail">${actionDetail(action)}</span>
      <span class="action-status">pending</span>
    `;
    timeline.appendChild(card);
  });
  actionsBar.classList.remove('hidden');
}

function updateActionCard(index, status, error) {
  const timeline = actionsBar.querySelector('#action-timeline');
  if (!timeline) return;
  const card = timeline.querySelector(`.action-card[data-index="${index}"]`);
  if (!card) return;
  card.classList.remove('pending', 'running', 'done', 'error');
  card.classList.add(status);
  const statusEl = card.querySelector('.action-status');
  if (statusEl) statusEl.textContent = status === 'error' && error ? error : status;
}

// ---- Execute pending actions ----
async function runPendingActions() {
  if (!pendingActions || actionRunning) return;
  actionRunning = true;
  runAllBtn.disabled = true;
  skipBtn.disabled = false;

  renderActionTimeline();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (!tabId) {
    addMessage('error', 'No active tab to execute actions on.');
    pendingActions = null;
    actionsBar.classList.add('hidden');
    actionRunning = false;
    runAllBtn.disabled = false;
    return;
  }

  const total = pendingActions.length;
  for (let i = 0; i < pendingActions.length; i++) {
    const action = pendingActions[i];
    if (action.type === 'done') {
      updateActionCard(i, 'done');
      if (action.response) addMessage('assistant', action.response);
      continue;
    }
    updateActionCard(i, 'running');
    addMessage('action', `${ACTION_META[action.type]?.icon || '•'} ${action.type}: ${actionDetail(action)}`);
    const result = await chrome.runtime.sendMessage({
      type: 'EXECUTE_ACTIONS',
      actions: [action],
      tabId,
    });
    if (!result?.ok) {
      const err = result?.error || 'unknown error';
      updateActionCard(i, 'error', err);
      addMessage('error', `Action failed: ${err}`);
      break;
    }
    updateActionCard(i, 'done');
    await new Promise((r) => setTimeout(r, 600));
    await refreshPageContext();
  }

  pendingActions = null;
  setTimeout(() => actionsBar.classList.add('hidden'), 1200);
  actionRunning = false;
  runAllBtn.disabled = false;
}

// ---- Messages ----
function addMessage(role, text) {
  addMessageDOM(role, text);
  // Auto-read assistant messages via TTS
  if (role === 'assistant' && ttsAutoRead) {
    speakText(text);
  }
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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markdownToHtml(md) {
  if (!md) return '';
  // Escape HTML to prevent XSS
  var html = escapeHtml(md);

  // Horizontal rules
  html = html.replace(/^-{3,}$/gm, '<hr>');

  // Headings (### → <h3>, #### → <h4>, etc.)
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Code blocks: triple backtick with optional language
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
    var cls = lang ? ' class="lang-' + escapeHtml(lang) + '"' : '';
    return '<pre><code' + cls + '>' + escapeHtml(code.trim()) + '</code></pre>';
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, function(_, c) { return '<code>' + escapeHtml(c) + '</code>'; });
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links — only allow safe URL schemes
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, function(_, text, url) {
    var safeUrl = url.trim();
    // Only http:, https:, mailto:, and relative paths are allowed
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(safeUrl)) {
      return text; // render as plain text instead of a link
    }
    return '<a href="' + safeUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
  });
  // Bare URL auto-linking — wrap http(s):// URLs in anchor tags
  html = html.replace(/(?<!=\"|>)(https?:\/\/[^\s<\"\)\]>,;!?]+)/g, function(_, url) {
    var safeUrl = url.replace(/[<>]/g, '');
    if (!/^(https?:)/i.test(safeUrl)) return url;
    return '<a href="' + safeUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">' + safeUrl + '</a>';
  });

  // Lists + paragraphs: single-pass line processor
  var lines = html.split('\n');
  var out = [];
  var listTag = null;
  var listStart = -1;
  function flushList(i) {
    if (listStart === -1) return;
    var tag = listTag;
    out.push('<' + tag + '>');
    for (var li = listStart; li < i; li++) {
      var item = lines[li].replace(/^\d+\.\s+|^[-*]\s+/, '');
      out.push('<li>' + item + '</li>');
    }
    out.push('</' + tag + '>');
    listStart = -1;
    listTag = null;
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\d+\.\s/.test(line)) {
      if (listTag === 'ul' && listStart !== -1) flushList(i);
      if (listStart === -1) { listStart = i; listTag = 'ol'; }
    } else if (/^[-*]\s/.test(line)) {
      if (listTag === 'ol' && listStart !== -1) flushList(i);
      if (listStart === -1) { listStart = i; listTag = 'ul'; }
    } else if (/^\s*$/.test(line) && listStart !== -1) {
      flushList(i);
    } else {
      if (listStart !== -1) flushList(i);
      out.push(line);
    }
  }
  if (listStart !== -1) flushList(lines.length);
  html = out.join('\n');

  // Paragraphs for double newlines (must run last)
  var paras = html.split('\n\n').filter(function(p) { return p.trim(); });
  if (paras.length > 1) {
    html = paras.map(function(p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  } else {
    html = html.replace(/\n/g, '<br>');
  }
  return html;
}

function addMessageDOM(role, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  const body = document.createElement('div');
  body.className = 'msg-body';

  // Render markdown for assistant messages, keep others as plain text
  if (role === 'assistant' || role === 'system' || role === 'thinking') {
    body.innerHTML = markdownToHtml(text);
  } else {
    body.textContent = text;
  }

  div.appendChild(body);

  // TTS speaker button on assistant and system messages (only non-empty)
  if ((role === 'assistant' || role === 'system') && text && text.trim()) {
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'tts-btn msg-tts-btn';
    ttsBtn.textContent = '🔊';
    ttsBtn.title = 'Read aloud';
    ttsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakText(text, ttsBtn);
    });
    div.appendChild(ttsBtn);
  }

  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  return div;
}

// ---- Presets ----

async function loadPresets() {
  const saved = await chrome.storage.local.get(STORAGE_PRESETS_KEY);
  customPresets = saved[STORAGE_PRESETS_KEY] || {};

  // Restore last used preset
  const lastPreset = await chrome.storage.local.get('zoActivePreset');
  if (lastPreset.zoActivePreset) {
    activePreset = lastPreset.zoActivePreset;
    presetSelect.value = lastPreset.zoActivePreset;
  }
}

async function saveCustomPresets() {
  await chrome.storage.local.set({ [STORAGE_PRESETS_KEY]: customPresets });
}

function getPreset(id) {
  // Check custom presets first, then built-in
  if (customPresets[id]) return customPresets[id];
  if (BUILTIN_PRESETS[id]) return BUILTIN_PRESETS[id];
  return null;
}

function applyPreset() {
  const id = presetSelect.value;
  if (!id) {
    activePreset = null;
    chrome.storage.local.remove('zoActivePreset');
    addSystemMessage('Default co-browse mode. Zo will see your page and respond with actions.');
    return;
  }

  // Reload options to include custom presets
  rebuildPresetOptions();

  const preset = getPreset(id);
  if (!preset) return;

  activePreset = id;
  chrome.storage.local.set({ zoActivePreset: id });
  addSystemMessage(`🔄 **${preset.name}** preset active. ${preset.description}`);
}

function rebuildPresetOptions() {
  // Save current selection
  const currentVal = presetSelect.value;

  // Clear and rebuild
  presetSelect.innerHTML = '<option value="">Default (co-browse)</option>';
  for (const [id, p] of Object.entries(BUILTIN_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `✨ ${p.name}`;
    presetSelect.appendChild(opt);
  }

  // Separator for custom presets
  const customIds = Object.keys(customPresets);
  if (customIds.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '⎯ Custom ⎯';
    presetSelect.appendChild(sep);

    for (const [id, p] of Object.entries(customPresets)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `👤 ${p.name}`;
      opt.title = p.description;
      presetSelect.appendChild(opt);
    }
  }

  // Restore selection
  if (currentVal) presetSelect.value = currentVal;
}

async function startPresetCreation() {
  const input = document.createElement('div');
  input.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:999;';
  input.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;width:280px;">
      <h3 style="font-size:14px;margin:0 0 8px;color:var(--text);">Create Preset with Zo</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;">Describe what you want this preset to do:</p>
      <textarea id="preset-desc-input" style="width:100%;height:80px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px;font-size:13px;resize:none;font-family:var(--font);" placeholder="e.g. Extract all product prices and availability from shopping pages"></textarea>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button id="generate-preset-confirm" class="btn btn-primary btn-sm" style="flex:1;">Generate ✨</button>
        <button id="generate-preset-cancel" class="btn btn-sm">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(input);

  const descInput = input.querySelector('#preset-desc-input');
  descInput.focus();

  input.querySelector('#generate-preset-cancel').addEventListener('click', () => input.remove());
  input.querySelector('#generate-preset-confirm').addEventListener('click', async () => {
    const desc = descInput.value.trim();
    if (!desc) return;
    input.remove();

    addSystemMessage(`🤖 Generating preset for: "${desc}"...`);
    const resp = await chrome.runtime.sendMessage({
      type: 'GENERATE_PRESET',
      description: desc,
    });

    // Remove the generating message
    const msgs = msgsEl.querySelectorAll('.msg-system');
    if (msgs.length > 0) msgs[msgs.length - 1].remove();

    if (resp.error) {
      addSystemMessage(`❌ Failed to create preset: ${resp.error}`);
      return;
    }

    const preset = resp.preset;
    if (!preset.name || !preset.systemPrompt) {
      addSystemMessage('❌ Zo returned an incomplete preset. Try again with a more specific description.');
      return;
    }

    // Generate a unique id
    const id = 'custom_' + Date.now();
    customPresets[id] = {
      ...preset,
      isBuiltin: false,
      id,
      createdAt: Date.now(),
    };
    await saveCustomPresets();
    rebuildPresetOptions();

    // Select the new preset
    presetSelect.value = id;
    applyPreset();
    addSystemMessage(`✅ Custom preset **${preset.name}** created and activated.`);
  });
}

function addSystemMessage(text) {
  msgsEl.innerHTML += `<div class="msg msg-system"><div class="msg-body">${text}</div></div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function loadQuickActions() {
  const result = await chrome.storage.sync.get(STORAGE_ACTIONS_KEY);
  const actions = result[STORAGE_ACTIONS_KEY];
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    // First run — seed defaults
    await chrome.storage.sync.set({ [STORAGE_ACTIONS_KEY]: DEFAULT_QUICK_ACTIONS });
    renderQuickActions(DEFAULT_QUICK_ACTIONS);
  } else {
    renderQuickActions(actions);
  }
}

function renderQuickActions(actions) {
  const container = $('#action-chips');
  if (!container) return;
  container.innerHTML = '';
  for (const a of actions) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = a.label;
    chip.title = a.prompt;
    container.appendChild(chip);
  }
}

// ---- STT (Speech-to-Text) ----

function startRecording() {
  if (isRecording) { stopRecording(); return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addMessageDOM('error', 'Speech recognition not supported in this browser. Try Chrome.');
    return;
  }

  // Request microphone access first — Chrome blocks SpeechRecognition in
  // extension pages without an explicit getUserMedia grant. Once the user
  // approves, start recognition.
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      // Stop the stream immediately — we only needed the permission prompt
      stream.getTracks().forEach(t => t.stop());

      try {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = sttLang;

        recognition.onresult = (event) => {
          let final = '';
          sttInterim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              sttInterim += event.results[i][0].transcript;
            }
          }
          if (final) {
            input.value = (input.value + ' ' + final).trim();
          }
          // Show interim in placeholder
          if (sttInterim) {
            input.placeholder = '🎤 ' + sttInterim;
          }
        };

        recognition.onerror = (event) => {
          stopRecording();
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            addMessageDOM('error', `🎤 STT error: ${event.error}`);
          }
        };

        recognition.onend = () => {
          stopRecording();
        };

        recognition.start();
        isRecording = true;
        micBtn.classList.add('recording');
        micBtn.textContent = '🔴';
        micBtn.title = 'Stop recording';
      } catch (err) {
        addMessageDOM('error', `🎤 STT error: ${err.message}`);
      }
    })
    .catch((err) => {
      addMessageDOM('error', `🎤 Microphone access denied: ${err.message}. Grant microphone permission in Chrome settings.`);
    });
}

function stopRecording() {
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
  isRecording = false;
  micBtn.classList.remove('recording');
  micBtn.textContent = '🎤';
  micBtn.title = 'Voice input (STT)';
  if (sttInterim) {
    input.value = (input.value + ' ' + sttInterim).trim();
    sttInterim = '';
  }
  input.placeholder = 'Ask Zo about this page...';
}

// ---- TTS (Text-to-Speech) ----

async function loadTtsConfig() {
  const saved = await chrome.storage.sync.get(['zoTtsAutoRead', 'zoTtsLang', 'zoTtsRate', 'zoTtsVoice']);
  ttsAutoRead = saved.zoTtsAutoRead || false;
  ttsLang = saved.zoTtsLang || 'en-US';
  ttsRate = parseFloat(saved.zoTtsRate) || 1.0;
  ttsVoice = saved.zoTtsVoice || '';
}

/** Speak text using chrome.tts (extension-native API — no autoplay restrictions). */
function speakText(text, triggerEl) {
  if (!text || !text.trim()) return;

  // If the same button is clicked while speaking, stop and return
  if (isSpeaking && triggerEl && triggerEl === currentTtsBtnEl) {
    stopSpeaking();
    return;
  }

  // If something else is speaking (e.g. auto-read), stop it and continue to speak new text
  if (isSpeaking) {
    chrome.tts.stop();
    isSpeaking = false;
    if (currentTtsBtnEl) {
      currentTtsBtnEl.textContent = '🔊';
      currentTtsBtnEl.title = 'Read aloud';
      currentTtsBtnEl.classList.remove('speaking');
      currentTtsBtnEl = null;
    }
  }

  const plain = text
    .replace(/[*_#`\[\]]/g, '')
    .replace(/\n{2,}/g, '. ')
    .trim();
  if (!plain) return;

  isSpeaking = true;
  if (triggerEl) {
    currentTtsBtnEl = triggerEl;
    triggerEl.textContent = '⏹';
    triggerEl.title = 'Stop';
    triggerEl.classList.add('speaking');
  }

  chrome.tts.speak(plain, {
    lang: ttsLang,
    rate: ttsRate,
    voiceName: ttsVoice || undefined,
    onEvent: (event) => {
      if (event.type === 'end' || event.type === 'interrupted' || event.type === 'cancelled' || event.type === 'error') {
        isSpeaking = false;
        if (currentTtsBtnEl) {
          currentTtsBtnEl.textContent = '🔊';
          currentTtsBtnEl.title = 'Read aloud';
          currentTtsBtnEl.classList.remove('speaking');
          currentTtsBtnEl = null;
        }
      }
    },
  });
}

function stopSpeaking() {
  chrome.tts.stop();
  isSpeaking = false;
  if (currentTtsBtnEl) {
    currentTtsBtnEl.textContent = '🔊';
    currentTtsBtnEl.title = 'Read aloud';
    currentTtsBtnEl.classList.remove('speaking');
    currentTtsBtnEl = null;
  }
}

// ---- Streaming (port-based) ----

let streamPort = null;
let streamSession = { active: false, sessionId: 0, msgEl: null, fullText: '', remainingActions: null };

function connectStreamingPort() {
  try {
    streamPort = chrome.runtime.connect({ name: 'cobrowse-stream' });
    streamPort.onMessage.addListener(handleStreamMessage);
    streamPort.onDisconnect.addListener(() => {
      streamPort = null;
      // Reconnect on next sendQuery
    });
  } catch {
    streamPort = null;
  }
}

function handleStreamMessage(msg) {
  switch (msg.type) {
    case 'STREAM_CHUNK': {
      // First chunk — remove thinking indicator, create assistant message
      if (!streamSession.active) return;
      if (!streamSession.msgEl) {
        const thinking = msgsEl.querySelector('.msg-thinking');
        if (thinking) thinking.remove();
        streamSession.msgEl = addMessageDOM('assistant', msg.text);
        streamSession.fullText = msg.text;
      } else {
        streamSession.fullText = msg.text;
        const body = streamSession.msgEl.querySelector('.msg-body');
        if (body) {
          body.innerHTML = markdownToHtml(msg.text);
        }
      }
      break;
    }
    case 'STREAM_DONE': {
      if (!streamSession.active) return;
      streamSession.active = false;
      // Finalize message
      if (streamSession.msgEl) {
        const body = streamSession.msgEl.querySelector('.msg-body');
        if (body) {
          body.innerHTML = markdownToHtml(msg.fullText || streamSession.fullText || msg.reasoning || '');
        }
        // Add TTS button if not already present
        if (!streamSession.msgEl.querySelector('.tts-btn')) {
          const text = msg.fullText || streamSession.fullText || msg.reasoning || '';
          const ttsBtn = document.createElement('button');
          ttsBtn.className = 'tts-btn msg-tts-btn';
          ttsBtn.textContent = '🔊';
          ttsBtn.title = 'Read aloud';
          ttsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            speakText(text, ttsBtn);
          });
          streamSession.msgEl.appendChild(ttsBtn);
        }
      } else {
        // No streaming chunks — fallback to addMessage
        if (msg.fullText || msg.reasoning) {
          addMessage('assistant', msg.fullText || msg.reasoning);
        }
      }

      // Persist to conversation
      const displayText = msg.fullText || streamSession.fullText || msg.reasoning || '';
      if (displayText) {
        const conv = getActiveConversation();
        if (conv) {
          conv.messages.push({ role: 'assistant', text: displayText, timestamp: Date.now() });
          if (conv.messages.length > 50) {
            conv.messages = conv.messages.slice(-50);
          }
          saveCurrentConversation();
        }
      }

      // Handle actions
      const actions = msg.actions || [];
      if (actions.length > 0) {
        handleStreamActions(actions, msg.reasoning);
      }

      // Re-enable input
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      streamSession.msgEl = null;
      streamSession.fullText = '';
      break;
    }
    case 'STREAM_ERROR': {
      if (!streamSession.active) return;
      streamSession.active = false;
      const thinking = msgsEl.querySelector('.msg-thinking');
      if (thinking) thinking.remove();
      addMessage('error', msg.error);
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      streamSession.msgEl = null;
      streamSession.fullText = '';
      break;
    }
  }
}

function handleStreamActions(actions, reasoning) {
  const navigateActions = actions.filter((a) => a.type === 'navigate');
  const domActions = actions.filter((a) => a.type !== 'navigate' && a.type !== 'done');
  const doneResponse = actions.find((a) => a.type === 'done')?.response;

  if (navigateActions.length) {
    addMessage('assistant', `📍 Navigating to: ${navigateActions[0].url}`);
    chrome.runtime.sendMessage({
      type: 'NAVIGATE',
      url: navigateActions[0].url,
    }).catch(() => {});
    setTimeout(async () => {
      await refreshPageContext();
      if (doneResponse) addMessage('assistant', doneResponse);
    }, 2000);
    return;
  }

  if (domActions.length) {
    pendingActions = domActions;
    actionsReasoning.textContent = `🧠 ${reasoning?.substring(0, 200) || ''}`;
    actionsBar.classList.remove('hidden');
    runPendingActions();
  }

  // No actions or already handled — input state is managed by STREAM_DONE
}

// Override sendQuery for streaming
sendQuery = async function() {
  const query = input.value.trim();
  if (!query || actionRunning) return;
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  await ensureActiveConversation();
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

  // ---- Quick Commands (!) ----
  let effectiveQuery = query;
  let tempPreset = null;
  if (query.startsWith('!')) {
    const bang = parseBangCommand(query);
    if (bang.inlineReply) {
      addMessage('user', query);
      addMessage('bot', bang.inlineReply);
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    if (bang.isSave) {
      addMessage('user', query);
      addMessage('thinking', 'Saving to workspace...');
      const saveResp = await chrome.runtime.sendMessage({
        type: 'SAVE_PAGE',
        pageContext: currentContext,
        savePath: bang.savePath || '',
      });
      const thinking = msgsEl.querySelector('.msg-thinking');
      if (thinking) thinking.remove();
      if (saveResp.error) {
        addMessage('error', saveResp.error);
      } else {
        addMessage('assistant', saveResp.response || 'Page saved to workspace.');
      }
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    if (bang.isAuto) {
      addMessage('user', query);
      addMessage('thinking', 'Creating automation...');
      const autoResp = await chrome.runtime.sendMessage({
        type: 'CREATE_AUTOMATION',
        instruction: bang.instruction || '',
        pageContext: currentContext,
      });
      const thinking = msgsEl.querySelector('.msg-thinking');
      if (thinking) thinking.remove();
      if (autoResp.error) {
        addMessage('error', autoResp.error);
      } else {
        addMessage('assistant', autoResp.response || 'Automation created.');
      }
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    if (bang.isDuckdb) {
      // !query / !data — natural-language DuckDB query
      addMessage('user', query);
      addMessage('thinking', 'Querying datasets...');
      const dbResp = await chrome.runtime.sendMessage({
        type: 'DUCKDB_QUERY',
        naturalQuery: bang.naturalQuery,
      });
      const thinking = msgsEl.querySelector('.msg-thinking');
      if (thinking) thinking.remove();
      if (dbResp.error) {
        addMessage('error', dbResp.error);
      } else {
        addDuckdbResult(dbResp);
      }
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    effectiveQuery = bang.query;
    tempPreset = bang.preset;
  }

  addMessage('user', query);
  addMessage('thinking', 'Zo is thinking...');

  // Determine preset prompts
  let presetSystemPrompt, presetInstructions;
  const activePresetResolved = tempPreset || activePreset;
  if (activePresetResolved) {
    const preset = getPreset(activePresetResolved);
    if (preset) {
      presetSystemPrompt = preset.systemPrompt;
      presetInstructions = preset.instructions;
    }
  }

  // Start streaming session
  streamSession.sessionId++;
  streamSession.active = true;
  streamSession.msgEl = null;
  streamSession.fullText = '';
  const thisSession = streamSession.sessionId;

  if (streamPort) {
    streamPort.postMessage({
      type: 'ASK_ZO',
      pageContext: currentContext,
      userQuery: effectiveQuery,
      modelName: config.selectedModel || undefined,
      personaId: config.selectedPersona || undefined,
      presetSystemPrompt: presetSystemPrompt,
      presetInstructions: presetInstructions,
    });
  } else {
    // Fallback to one-shot if no port
    const resp = await chrome.runtime.sendMessage({
      type: 'ASK_ZO',
      pageContext: currentContext,
      userQuery: effectiveQuery,
      modelName: config.selectedModel || undefined,
      personaId: config.selectedPersona || undefined,
      presetSystemPrompt: presetSystemPrompt,
      presetInstructions: presetInstructions,
    });

    const thinking = msgsEl.querySelector('.msg-thinking');
    if (thinking) thinking.remove();
    streamSession.active = false;

    if (resp.error) {
      addMessage('error', resp.error);
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }

    const output = resp.output;
    let reasoning = '';
    let actions = [];

    if (typeof output === 'object' && output !== null) {
      reasoning = output.reasoning || '';
      actions = output.actions || [];
    } else if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output);
        reasoning = parsed.reasoning || '';
        actions = parsed.actions || [];
      } catch {
        reasoning = output;
      }
    }

    if (!actions.length) {
      addMessage('assistant', reasoning || 'Done.');
    } else {
      handleStreamActions(actions, reasoning);
      if (actions.some(a => a.type === 'done')) {
        addMessage('assistant', reasoning || 'Done.');
      }
    }

    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
};
function cancelStream() {
  if (streamSession.active) {
    streamSession.active = false;
    streamSession.msgEl = null;
    streamSession.fullText = '';
    input.disabled = false;
    sendBtn.disabled = false;
  }
}
