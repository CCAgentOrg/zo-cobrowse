// Zo Co-browse — Side Panel Logic

import { parseBangCommand, BANG_COMMANDS } from './lib/bang-commands.js';
import { BUILTIN_MODES, DEFAULT_MODE_ID, resolveMode, presetToMode, normalizeActions } from './lib/modes.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- Constants ----
const MAX_HISTORY = 50;
const OLD_STORAGE_KEY = 'cobrowse_history';
// Defensive guard: if background never replies and the port stays alive,
// the thinking indicator would persist forever. This clears it + re-enables
// input after the deadline so the panel is never stuck.
const THINKING_TIMEOUT_MS = 60000;
let thinkingTimeout = null;
function startThinkingTimeout() {
  clearThinkingTimeout();
  thinkingTimeout = setTimeout(() => {
    thinkingTimeout = null;
    const thinking = msgsEl?.querySelector('.msg-thinking');
    if (thinking) thinking.remove();
    if (streamSession.active) {
      streamSession.active = false;
      streamSession.msgEl = null;
      streamSession.fullText = '';
    }
    if (typeof input !== 'undefined' && input) input.disabled = false;
    if (typeof sendBtn !== 'undefined' && sendBtn) sendBtn.disabled = false;
  }, THINKING_TIMEOUT_MS);
}
function clearThinkingTimeout() {
  if (thinkingTimeout) { clearTimeout(thinkingTimeout); thinkingTimeout = null; }
}
// ---- Safe text helper ----
function safeText(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  try { const s = JSON.stringify(v); return typeof s === 'string' ? s : ''; }
  catch { return ''; }
}

const STORAGE_CONVERSATIONS_KEY = 'cobrowse_convos';
const STORAGE_ACTIVE_KEY = 'cobrowse_active_id';
const STORAGE_MODES_KEY = 'cobrowse_modes';
const STORAGE_LEGACY_PRESETS_KEY = 'cobrowse_presets'; // migrated once, then ignored
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
let pendingActionsReasoning = '';   // reasoning to attach to the done-answer bubble
let currentContext = null;
let actionRunning = false;
let isHistoryView = false;

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
const modeSelect = $('#mode-select');
const createModeBtn = $('#create-mode-btn');

// ---- Modes ----
// Built-in Modes live in extension/lib/modes.js (imported as BUILTIN_MODES).
// Custom Modes are user-generated via the ✦ button and stored under
// STORAGE_MODES_KEY. The active Mode id is persisted under 'zoActiveMode'.

let customModes = {};
let activeModeId = DEFAULT_MODE_ID;


// ---- Init ----
init();

async function init() {
  bindEvents(); // bind FIRST so events always work even if async setup fails
  await loadConfig();
  await loadTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => loadTheme());
  updateStatus(config.hasToken);
  const { [OB_KEY]: obDone = false } = await chrome.storage.sync.get(OB_KEY);
  if (!obDone) { showOnboarding(); return; }
  await finishInit();
}

/** Remaining init — called on normal start and from completeOnboarding() */
async function finishInit() {
  try {
    await refreshPageContext();
    await checkPendingQuery();
    await migrateOldFormat();
    await loadConversations();
    await fetchModelsAndPersonas();
    await loadModes();
    await loadQuickActions();
    await loadTtsConfig();
    connectStreamingPort();
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[STORAGE_ACTIONS_KEY]) {
        const actions = changes[STORAGE_ACTIONS_KEY].newValue;
        renderQuickActions(actions || []);
      }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PENDING_ZO_QUERY' && msg.text) {
        input.value = msg.text;
        sendQuery();
      }
    });
  } catch (e) {
    console.error('finishInit error:', e);
  } finally {
    renderView();
  }
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
  // The active Mode + persona are sourced directly from storage so the panel
  // stays in sync with options.js across reloads.
  const saved = await chrome.storage.sync.get(['zoActiveMode', 'zoPersonaId']);
  if (saved.zoPersonaId) config.selectedPersona = saved.zoPersonaId;
  syncModeSelect();
}

// Reflect activeModeId into the #mode-select dropdown.
function syncModeSelect() {
  if (modeSelect) modeSelect.value = activeModeId;
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
  const obView = document.getElementById('onboarding-view');
  if (obView) obView.classList.add('hidden');
  await finishInit();
  // Welcome message — added after finishInit so it survives loadConversations() DOM reset
  const msg = '🎉 **Onboarding complete!** Try asking Zo something about this page.';
  addMessage('assistant', msg);
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

  // Mode selection — the single source of truth for how Zo behaves + context.
  modeSelect.addEventListener('change', applyMode);
  createModeBtn.addEventListener('click', startModeCreation);

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

  // Open settings on status dot click (not double-click)
  statusDot.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Onboarding navigation
  const obNext = $('#ob-next');
  const obBack = $('#ob-back');
  const obSkip = $('#ob-skip');
  if (obNext) obNext.addEventListener('click', handleOnboardingNext);
  if (obBack) obBack.addEventListener('click', handleOnboardingBack);
  if (obSkip) obSkip.addEventListener('click', completeOnboarding);
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
    title: firstUserMsg ? String(firstUserMsg.text || '').substring(0, 60) : 'Previous session',
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

/**
 * Heal an assistant message persisted before the action-normalization fix.
 * Old code saved the raw `{reasoning, actions}` JSON blob as `msg.text` when
 * Zo returned key-first actions; those messages re-render as raw JSON forever,
 * even after the parse-path fix. This detects such blobs and splits them back
 * into the done.response (as text) + reasoning, so old conversations render
 * correctly on load. New messages already carry the resolved text/reasoning
 * and pass through unchanged. Non-JSON text is returned as-is.
 */
function healAssistantMessage(msg) {
  if (!msg || msg.role !== 'assistant') return msg;
  const text = typeof msg.text === 'string' ? msg.text : '';
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return msg;
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return msg; }
  if (!parsed || typeof parsed !== 'object') return msg;
  // Only treat it as a leaked payload if it has the signature fields.
  if (!('reasoning' in parsed) && !('actions' in parsed)) return msg;
  const actions = normalizeActions(parsed.actions);
  const doneAction = actions.find(a => a.type === 'done');
  const healedText = safeText(doneAction?.response) || safeText(parsed.reasoning) || text;
  const healedReasoning = msg.reasoning || safeText(parsed.reasoning) || undefined;
  // Mark so we don't re-parse every render.
  return { ...msg, text: healedText, reasoning: healedReasoning, healed: true };
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
      conv.title = String(firstUserMsg.text || '').substring(0, 60);
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
    const m = msg.role === 'assistant' ? healAssistantMessage(msg) : msg;
    const el = addMessageDOM(m.role, m.text);
    if (m.role === 'assistant' && m.reasoning) addReasoningBubble(el, m.reasoning);
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
      const m = msg.role === 'assistant' ? healAssistantMessage(msg) : msg;
      const el = addMessageDOM(m.role, m.text);
      if (m.role === 'assistant' && m.reasoning) addReasoningBubble(el, m.reasoning);
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
  // Tell the background how much context the active Mode wants (its tier).
  const mode = resolveMode(activeModeId, customModes);
  const resp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT', tier: mode.contextTier, modeId: activeModeId });
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
  s = safeText(s);
  if (s === '') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');
}

// ---- Action Timeline (#03) ----
// Renders an inline "⚡ Worked N steps · duration" run block in the chat stream
// (matching zo.computer), with grouped cards inside. Repeated consecutive
// actions collapse into a single card with a "× N" count.
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

/**
 * Stable identity key for an action, used to detect consecutive repeats that
 * should collapse into one timeline card (e.g. multiple clicks on the same
 * selector). Two actions share a key iff they are operationally identical.
 */
function actionKey(action) {
  if (!action || typeof action !== 'object') return '';
  return [action.type, action.selector || '', action.url || '',
          action.value || '', action.attribute || '',
          action.direction || '', String(action.ms || '')].join('|');
}

/**
 * Group consecutive identical actions into runs, matching zo.computer's
 * "Ran command · 3 times" pattern. Returns objects of shape
 * { action, count, indices: number[] } preserving original order; non-
 * consecutive duplicates stay separate. Pure (no DOM deps) → unit-testable.
 *
 * @param {object[]} actions
 * @returns {{ action: object, count: number, indices: number[] }[]}
 */
function groupActions(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const key = actionKey(a);
    const prev = out[out.length - 1];
    if (prev && actionKey(prev.action) === key) {
      prev.count++;
      prev.indices.push(i);
    } else {
      out.push({ action: a, count: 1, indices: [i] });
    }
  }
  return out;
}

// Format an elapsed duration in ms as a compact human string (e.g. "42s", "4m 57s").
function formatDuration(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) return '<1s';
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function renderActionTimeline() {
  if (!pendingActions) return;
  // Render inline in the chat stream (not in the separate #actions-bar), so a
  // run reads top-to-bottom as part of the turn like zo.computer. The bar's
  // Run All / Skip buttons still drive execution via their own handlers.
  let run = document.getElementById('action-run');
  if (run) run.remove();
  run = document.createElement('div');
  run.id = 'action-run';
  run.className = 'msg msg-action-run';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'action-run-header';
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', 'Show action steps');
  header.innerHTML =
    '<span class="action-run-caret">▸</span>' +
    '<span class="action-run-label">⚡ Working…</span>' +
    '<span class="action-run-count"></span>' +
    '<span class="action-run-duration"></span>';
  header.addEventListener('click', () => {
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    header.setAttribute('aria-label', expanded ? 'Show action steps' : 'Hide action steps');
    const caret = header.querySelector('.action-run-caret');
    if (caret) caret.textContent = expanded ? '▸' : '▾';
    const body = run.querySelector('.action-run-body');
    if (body) body.hidden = expanded;
  });
  run.appendChild(header);

  const body = document.createElement('div');
  body.className = 'action-run-body';
  body.hidden = true;  // collapsed by default
  const timeline = document.createElement('div');
  timeline.id = 'action-timeline';
  body.appendChild(timeline);
  run.appendChild(body);

  // Grouped cards: consecutive identical actions collapse to one card.
  const groups = groupActions(pendingActions);
  for (const g of groups) {
    const meta = ACTION_META[g.action.type] || { icon: '•', label: g.action.type };
    const card = document.createElement('div');
    card.className = 'action-card pending';
    // Map every original index in this group to the same card so
    // updateActionCard(i) resolves the group's card for any member action.
    for (const idx of g.indices) card.dataset.index = card.dataset.index || String(idx);
    card.dataset.indices = g.indices.join(',');
    card.innerHTML =
      `<span class="action-icon">${meta.icon}</span>` +
      `<span class="action-label">${meta.label}</span>` +
      `<span class="action-detail">${actionDetail(g.action)}</span>` +
      (g.count > 1 ? `<span class="action-count">× ${g.count}</span>` : '') +
      `<span class="action-status">pending</span>`;
    timeline.appendChild(card);
  }

  msgsEl.appendChild(run);
  msgsEl.scrollTop = msgsEl.scrollHeight;
  // Keep the control bar (Run All / Skip) visible during the run.
  actionsBar.classList.remove('hidden');
}

function updateActionCard(index, status, error) {
  const timeline = document.getElementById('action-timeline');
  if (!timeline) return;
  // A grouped card covers multiple original indices; match by membership.
  const card = [...timeline.querySelectorAll('.action-card')].find((c) =>
    (c.dataset.indices || '').split(',').map(Number).includes(index)
  );
  if (!card) return;
  card.classList.remove('pending', 'running', 'done', 'error');
  card.classList.add(status);
  const statusEl = card.querySelector('.action-status');
  if (statusEl) statusEl.textContent = status === 'error' && error ? error : status;
}

// Update the inline run header summary (label + step count + duration).
function updateActionRunHeader(label, count, durationMs) {
  const run = document.getElementById('action-run');
  if (!run) return;
  const labelEl = run.querySelector('.action-run-label');
  const countEl = run.querySelector('.action-run-count');
  const durEl = run.querySelector('.action-run-duration');
  if (labelEl && label) labelEl.textContent = label;
  if (countEl && count) countEl.textContent = `· ${count} step${count === 1 ? '' : 's'}`;
  if (durEl) durEl.textContent = durationMs != null ? `· ${formatDuration(durationMs)}` : '';
}

// ---- Execute pending actions ----
async function runPendingActions() {
  if (!pendingActions || actionRunning) return;
  // Snapshot the array so the Skip button nulling `pendingActions` mid-loop
  // can't cause a TypeError on the next length read.
  const actions = pendingActions;
  actionRunning = true;
  runAllBtn.disabled = true;
  skipBtn.disabled = false;

  const runStartTime = Date.now();
  renderActionTimeline();
  // Live header: count includes the done action (matches "Worked N steps").
  updateActionRunHeader('⚡ Working…', actions.length, null);

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

  for (let i = 0; i < actions.length; i++) {
    // Stop if the user clicked Skip (nulls pendingActions) between awaits.
    if (!pendingActions) break;
    const action = actions[i];
    if (action.type === 'done') {
      updateActionCard(i, 'done');
      if (action.response) {
        const doneEl = addMessage('assistant', action.response);
        // Attach the reasoning bubble to the answer element (the message the
        // user actually reads), not the (possibly empty) streamed-text element.
        addReasoningBubble(doneEl, pendingActionsReasoning);
      }
      continue;
    }
    updateActionCard(i, 'running');
    // No separate inline ".msg-action" message — the card in the run timeline
    // is the inline record now (avoids the prior duplicate rendering).
    const actionStart = Date.now();
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

  const elapsed = Date.now() - runStartTime;
  const completedCount = actions.length;
  // Finalize the inline run header: "⚡ Worked N steps · <duration>".
  updateActionRunHeader('⚡ Worked', completedCount, elapsed);

  pendingActions = null;
  pendingActionsReasoning = '';
  setTimeout(() => actionsBar.classList.add('hidden'), 1200);
  actionRunning = false;
  runAllBtn.disabled = false;
}

// ---- Messages ----
function addMessage(role, text) {
  text = safeText(text);
  const div = addMessageDOM(role, text);
  // Auto-read assistant messages via TTS
  if (role === 'assistant' && ttsAutoRead && text) {
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
  return div;
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

  // Tables: markdown pipe tables
  html = html.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, function(_, headerRow, bodyRows) {
    var headers = headerRow.split('|').filter(function(c) { return c.trim(); });
    var thead = '<thead><tr>' + headers.map(function(h) { return '<th>' + h.trim() + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>';
    var rows = bodyRows.trim().split('\n');
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].split('|').filter(function(c) { return c.trim(); });
      if (cells.length) {
        tbody += '<tr>' + cells.map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>';
      }
    }
    tbody += '</tbody>';
    return '<table>' + thead + tbody + '</table>';
  });

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
  text = safeText(text);
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

// Collapsible "💭 Thinking" bubble rendered above an assistant message body,
// showing the reasoning field Zo returns alongside its actions. No-ops on
// empty reasoning so non-reasoning modes (ask/visual) are unaffected.
// Collapsed by default; click the header to expand.
/**
 * Derive a short, plain-text summary of a reasoning string for the collapsed
 * 💭 Thought bubble header (matches zo.computer, which shows e.g.
 * "Inspecting site responsiveness issues" rather than a char count).
 *
 * First sentence wins; otherwise the first ~80 chars. Markdown markers
 * (#, *, `, >, -, leading list bullets) are stripped so the preview reads as
 * prose. Pure (no DOM deps) so it's unit-testable directly.
 *
 * @param {string} text
 * @param {number} [max=80]
 * @returns {string}
 */
function reasoningSummary(text, max = 80) {
  const raw = safeText(text);
  if (!raw || !raw.trim()) return '';
  // Strip markdown structural markers so the preview reads as prose.
  const cleaned = raw
    .replace(/^#{1,6}\s+/gm, '')      // headings
    .replace(/^\s*[-*+]\s+/gm, '')    // list bullets
    .replace(/^\s*>\s?/gm, '')        // blockquotes
    .replace(/`{1,3}/g, '')           // inline/code fences
    .replace(/\*\*?([^*]+)\*\*?/g, '$1') // bold
    .replace(/__?([^_]+)__?/g, '$1')     // bold/italic _
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // First sentence (terminated by . ! ?) if it fits; else truncate.
  const sentenceEnd = cleaned.search(/[.!?]\s/);
  let summary;
  if (sentenceEnd !== -1 && sentenceEnd + 1 <= max) {
    summary = cleaned.slice(0, sentenceEnd + 1).trim();
  } else {
    summary = cleaned.slice(0, max).trim();
    if (cleaned.length > max) summary += '…';
  }
  return summary;
}

function addReasoningBubble(parentMsgEl, reasoning) {
  if (!parentMsgEl) return;
  const text = safeText(reasoning);
  if (!text || !text.trim()) return;

  // Don't add a duplicate bubble (e.g. on re-render)
  if (parentMsgEl.querySelector('.msg-thinking-bubble')) return;

  const bubble = document.createElement('div');
  bubble.className = 'msg-thinking-bubble';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'thinking-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Show reasoning');
  const caret = document.createElement('span');
  caret.className = 'thinking-caret';
  caret.textContent = '▸';
  const label = document.createElement('span');
  label.className = 'thinking-label';
  label.textContent = '💭 Thought';
  toggle.appendChild(caret);
  toggle.appendChild(label);
  // Collapsed preview: a one-line gist of the reasoning (matches zo.computer's
  // "Inspecting site responsiveness issues" header). Truncated with ellipsis via CSS.
  const summary = reasoningSummary(text);
  if (summary) {
    const summaryEl = document.createElement('span');
    summaryEl.className = 'thinking-summary';
    summaryEl.textContent = `— ${summary}`;
    toggle.appendChild(summaryEl);
  }
  const meta = document.createElement('span');
  meta.className = 'thinking-meta';
  meta.textContent = `${text.length} chars`;
  toggle.appendChild(meta);

  const content = document.createElement('div');
  content.className = 'thinking-content';
  content.hidden = true;
  content.innerHTML = markdownToHtml(text);

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.setAttribute('aria-label', expanded ? 'Show reasoning' : 'Hide reasoning');
    caret.textContent = expanded ? '▸' : '▾';
    content.hidden = expanded;
  });

  bubble.appendChild(toggle);
  bubble.appendChild(content);

  // Insert above the message body so it reads: thinking → answer
  const body = parentMsgEl.querySelector('.msg-body');
  if (body) {
    parentMsgEl.insertBefore(bubble, body);
  } else {
    parentMsgEl.insertBefore(bubble, parentMsgEl.firstChild);
  }
}

// ---- Presets ----

async function loadModes() {
  // One-time migration: legacy 'cobrowse_presets' → 'cobrowse_modes'.
  const both = await chrome.storage.local.get([STORAGE_MODES_KEY, STORAGE_LEGACY_PRESETS_KEY]);
  if (!both[STORAGE_MODES_KEY] && both[STORAGE_LEGACY_PRESETS_KEY]) {
    const migrated = {};
    for (const [id, preset] of Object.entries(both[STORAGE_LEGACY_PRESETS_KEY])) {
      // Map legacy preset ids to new Mode ids where they diverge.
      let modeId = id;
      if (modeId === 'scrape') modeId = 'extract';
      else if (modeId === 'qa') modeId = 'ask';
      migrated[modeId] = presetToMode({ ...preset, id: modeId });
    }
    customModes = migrated;
    await chrome.storage.local.set({ [STORAGE_MODES_KEY]: customModes });
  } else {
    customModes = both[STORAGE_MODES_KEY] || {};
  }
  rebuildModeOptions();

  // Restore last used Mode. Migrate legacy 'zoActivePreset' → 'zoActiveMode'.
  const activeKeys = await chrome.storage.local.get(['zoActivePreset']);
  const activeModeSaved = await chrome.storage.sync.get(['zoActiveMode']);
  let restored = activeModeSaved.zoActiveMode || activeKeys.zoActivePreset;
  if (restored === 'scrape') restored = 'extract';
  else if (restored === 'qa') restored = 'ask';
  activeModeId = restored || DEFAULT_MODE_ID;
  syncModeSelect();
}

async function saveCustomModes() {
  await chrome.storage.local.set({ [STORAGE_MODES_KEY]: customModes });
}

function applyMode() {
  const id = modeSelect.value || DEFAULT_MODE_ID;
  const mode = resolveMode(id, customModes);
  activeModeId = id;
  chrome.storage.sync.set({ zoActiveMode: id });
  rebuildModeOptions();
  syncModeSelect();
  const desc = mode.description ? ` ${mode.description}` : '';
  addSystemMessage(`🔄 **${mode.icon} ${mode.name}** mode active.${desc}`);
}

function rebuildModeOptions() {
  if (!modeSelect) return;
  const currentVal = activeModeId;

  modeSelect.innerHTML = '';
  for (const [id, m] of Object.entries(BUILTIN_MODES)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${m.icon} ${m.name}`;
    modeSelect.appendChild(opt);
  }

  // Separator + custom Modes
  const customIds = Object.keys(customModes);
  if (customIds.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '⎯ Custom ⎯';
    modeSelect.appendChild(sep);
    for (const [id, m] of Object.entries(customModes)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${m.icon || '✨'} ${m.name}`;
      opt.title = m.description || '';
      modeSelect.appendChild(opt);
    }
  }

  if (currentVal) modeSelect.value = currentVal;
}

async function startModeCreation() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:16px;width:280px;">
      <h3 style="font-size:14px;margin:0 0 8px;color:var(--text);">Create Mode with Zo</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;">Describe what you want this Mode to do:</p>
      <textarea id="mode-desc-input" style="width:100%;height:80px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px;font-size:13px;resize:none;font-family:var(--font);" placeholder="e.g. Extract all product prices and availability from shopping pages"></textarea>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button id="generate-mode-confirm" class="btn btn-primary btn-sm" style="flex:1;">Generate ✨</button>
        <button id="generate-mode-cancel" class="btn btn-sm">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const descInput = overlay.querySelector('#mode-desc-input');
  descInput.focus();

  overlay.querySelector('#generate-mode-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#generate-mode-confirm').addEventListener('click', async () => {
    const desc = descInput.value.trim();
    if (!desc) return;
    overlay.remove();

    addSystemMessage(`🤖 Generating Mode for: "${desc}"...`);
    const resp = await chrome.runtime.sendMessage({
      type: 'GENERATE_MODE',
      description: desc,
    });

    // Remove the generating message
    const msgs = msgsEl.querySelectorAll('.msg-system');
    if (msgs.length > 0) msgs[msgs.length - 1].remove();

    if (resp.error) {
      addSystemMessage(`❌ Failed to create Mode: ${resp.error}`);
      return;
    }

    const mode = resp.mode;
    if (!mode || !mode.name || !mode.systemPrompt) {
      addSystemMessage('❌ Zo returned an incomplete Mode. Try again with a more specific description.');
      return;
    }

    const id = 'custom_' + Date.now();
    customModes[id] = { ...mode, id, builtin: false };
    await saveCustomModes();
    rebuildModeOptions();

    // Select the new Mode
    activeModeId = id;
    syncModeSelect();
    chrome.storage.sync.set({ zoActiveMode: id });
    addSystemMessage(`✅ Custom Mode **${mode.name}** created and activated.`);
  });
}

function addSystemMessage(text) {
  // Route through addMessageDOM: HTML-escapes, parses markdown (so **bold**
  // renders), and uses appendChild instead of `innerHTML +=` which thrashed
  // the whole tree and destroyed existing TTS-button listeners.
  addMessageDOM('system', text);
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

// Declared (not bare-assigned) so the streaming override below is a valid
// reassignment in module (strict) scope. Without this declaration the bare
// `sendQuery = async function () {...}` throws ReferenceError at module
// evaluation, killing the entire side panel on load.
let sendQuery = async function () { /* replaced at the end of this file */ };

let streamPort = null;
let streamSession = { active: false, sessionId: 0, msgEl: null, fullText: '', remainingActions: null };

function connectStreamingPort() {
  try {
    const port = chrome.runtime.connect({ name: 'cobrowse-stream' });
    port.onMessage.addListener(handleStreamMessage);
    port.onDisconnect.addListener(() => {
      // Only null if this exact port is still the active one
      // Prevents stale onDisconnect from nulling a freshly reconnected port
      if (streamPort === port) {
        // If streaming session was active, clean up the UI and re-enable
        // input so the user isn't stuck with a permanently disabled panel.
        if (streamSession.active) {
          streamSession.active = false;
          clearThinkingTimeout();
          const thinking = msgsEl?.querySelector('.msg-thinking');
          if (thinking) thinking.remove();
          if (typeof input !== 'undefined' && input) input.disabled = false;
          if (typeof sendBtn !== 'undefined' && sendBtn) sendBtn.disabled = false;
        }
        streamPort = null;
      }
    });
    streamPort = port;
  } catch {
    streamPort = null;
  }
}

function handleStreamMessage(msg) {
  // Ignore stale messages from previous sessions
  if (msg.sessionId && msg.sessionId !== streamSession.sessionId) return;
  switch (msg.type) {
    case 'STREAM_CHUNK': {
      // First real progress — cancel the thinking timeout
      clearThinkingTimeout();
      // Remove any stale reconnecting banner(s)
      msgsEl.querySelectorAll('.msg-reconnecting').forEach(el => el.remove());
      // First chunk — remove thinking indicator, create assistant message
      if (!streamSession.active) return;
      if (!streamSession.msgEl) {
        const thinking = msgsEl.querySelector('.msg-thinking');
        if (thinking) thinking.remove();
        streamSession.msgEl = addMessageDOM('assistant', safeText(msg.text));
        streamSession.fullText = safeText(msg.text);
      } else {
        streamSession.fullText = safeText(msg.text);
        const body = streamSession.msgEl.querySelector('.msg-body');
        if (body) {
          body.innerHTML = markdownToHtml(safeText(msg.text));
        }
      }
      break;
    }
    case 'STREAM_DONE': {
      clearThinkingTimeout();
      const domActions = (msg.actions || []).filter((a) => a.type !== 'navigate' && a.type !== 'done');
      // Remove any stale thinking indicator regardless of active state
      const staleThinking = msgsEl.querySelector('.msg-thinking');
      if (staleThinking) staleThinking.remove();

      if (!streamSession.active) {
        // Stream was cancelled or port disconnected, but we still have a response —
        // show it via fallback message rather than silently dropping it
        if (msg.fullText || msg.reasoning || msg.actions?.length) {
          const fallbackText = safeText(msg.fullText) || safeText(msg.reasoning) || '';
          const fbEl = fallbackText ? addMessage('assistant', fallbackText) : null;
          if (fbEl) addReasoningBubble(fbEl, msg.reasoning);
          const actions = msg.actions || [];
          if (actions.length > 0) handleStreamActions(actions, msg.reasoning);
        }
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
        break;
      }
      // Remove any stale reconnecting banner
      const reconnDone = msgsEl.querySelector('.msg-reconnecting');
      if (reconnDone) reconnDone.remove();
      // Remove thinking indicator (for non-streaming responses where no STREAM_CHUNK was received)
      const thinkingDone = msgsEl.querySelector('.msg-thinking');
      if (thinkingDone) thinkingDone.remove();
      streamSession.active = false;
      // Remove any stale thinking indicator

      // Extract response text for non-action plain-text streaming
      const doneAction = (msg.actions || []).find(a => a.type === 'done');
      const responseText = safeText(doneAction?.response) || safeText(msg.fullText) || safeText(streamSession.fullText) || safeText(msg.reasoning) || '';

      // Finalize streaming message body. Always normalize to responseText
      // (the canonical final text) so the rendered DOM never lingers on a
      // partial streamed chunk. Structured actions are rendered separately
      // by handleStreamActions (navigate adds its own message; dom actions
      // render in the timeline), so this body holds the reasoning/done text.
      if (streamSession.msgEl) {
        const body = streamSession.msgEl.querySelector('.msg-body');
        if (body && responseText) {
          body.innerHTML = markdownToHtml(responseText);
        }
        // Add TTS button if not already present
        if (!streamSession.msgEl.querySelector('.tts-btn') && responseText) {
          const ttsBtn = document.createElement('button');
          ttsBtn.className = 'tts-btn msg-tts-btn';
          ttsBtn.textContent = '🔊';
          ttsBtn.title = 'Read aloud';
          ttsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            speakText(responseText, ttsBtn);
          });
          streamSession.msgEl.appendChild(ttsBtn);
        }
        // Render the reasoning field (if any) as a collapsible bubble above the body
        addReasoningBubble(streamSession.msgEl, msg.reasoning);
      } else {
        // No streaming chunks — fallback to addMessage
        if (responseText) {
          const el = addMessage('assistant', responseText);
          addReasoningBubble(el, msg.reasoning);
        } else if (msg.actions?.length) {
          // Response is in actions — will be rendered by handleStreamActions
        } else if (msg.fullText || msg.reasoning) {
          const el = addMessage('assistant', safeText(msg.fullText) || safeText(msg.reasoning));
          addReasoningBubble(el, msg.reasoning);
        } else {
          // Truly empty response. Don't claim success ("Done.") — surface a
          // hint so the user knows to check the service-worker console, where
          // background.js logs the first SSE chunk's fields for diagnosis.
          addMessage('assistant', '_Zo returned an empty response. Check the service worker console (chrome://extensions → Inspect views: service worker) for `[zo-cobrowse] first SSE chunk` to see the actual stream format._');
        }
      }

      // Persist to conversation
      if (responseText) {
        const conv = getActiveConversation();
        if (conv) {
          const reasoningVal = safeText(msg.reasoning) || undefined;
          conv.messages.push({ role: 'assistant', text: responseText, reasoning: reasoningVal, timestamp: Date.now() });
          if (conv.messages.length > 50) {
            conv.messages = conv.messages.slice(-50);
          }
          saveCurrentConversation();
        }
      }

      // Handle structured actions (navigate, dom, done)
      // handleStreamActions adds its own message for done actions
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
      clearThinkingTimeout();
      if (!streamSession.active) return;
      // Remove any stale reconnecting banner
      const reconnErr = msgsEl.querySelector('.msg-reconnecting');
      if (reconnErr) reconnErr.remove();
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
      case 'STREAM_RECONNECT_DONE': {
      // Successful reconnect — remove the reconnecting banner
      const reconnDone = msgsEl.querySelector('.msg-reconnecting');
      if (reconnDone) reconnDone.remove();
      break;
    }
      case 'STREAM_RECONNECT': {
      if (!streamSession.active) return;
      let reconn = msgsEl.querySelector('.msg-reconnecting');
      if (!reconn) {
        reconn = document.createElement('div');
        reconn.className = 'msg msg-reconnecting';
        reconn.innerHTML = '<div class="msg-body">➳ Reconnecting...</div>';
        msgsEl.appendChild(reconn);
      }
      reconn.querySelector('.msg-body').textContent = '➳ Reconnecting... attempt ' + msg.attempt + ' of ' + msg.maxRetries;
      reconn.scrollIntoView({ behavior: 'smooth' });
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
      if (doneResponse) {
        const el = addMessage('assistant', doneResponse);
        addReasoningBubble(el, reasoning);
      }
    }, 2000);
    return;
  }

  if (domActions.length) {
    pendingActions = domActions;
    pendingActionsReasoning = safeText(reasoning);
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
  let tempMode = null;
  if (query.startsWith('!')) {
    const bang = parseBangCommand(query);
    if (bang.inlineReply) {
      addMessage('user', query);
      addMessage('assistant', bang.inlineReply);
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
      if (saveResp && saveResp.error) {
        addMessage('error', saveResp.error);
      } else {
        addMessage('assistant', (saveResp && saveResp.response) || 'Page saved to workspace.');
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
      if (autoResp && autoResp.error) {
        addMessage('error', autoResp.error);
      } else {
        addMessage('assistant', (autoResp && autoResp.response) || 'Automation created.');
      }
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    if (bang.isDuckdb) {
      addMessage('user', query);
      addMessage('thinking', 'Querying datasets...');
      const dbResp = await chrome.runtime.sendMessage({
        type: 'DUCKDB_QUERY',
        naturalQuery: bang.naturalQuery,
      });
      const thinking = msgsEl.querySelector('.msg-thinking');
      if (thinking) thinking.remove();
      if (dbResp && dbResp.error) {
        addMessage('error', dbResp.error);
      } else {
        addDuckdbResult(dbResp || {});
      }
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      return;
    }
    effectiveQuery = bang.query;
    tempMode = bang.mode;
  }

  addMessage('user', query);
  addMessage('thinking', 'Zo is thinking...');
  startThinkingTimeout();

  // Resolve the Mode for this turn: a bang command can override the active
  // Mode for a single turn (tempMode), else use the selected Mode.
  const modeId = tempMode || activeModeId;

  // --- Streaming path: (re)connect port if needed ---
  if (!streamPort) connectStreamingPort();
  if (streamPort) {
    streamSession.sessionId++;
    const thisSessionId = streamSession.sessionId;
    streamSession.active = true;
    streamSession.msgEl = null;
    streamSession.fullText = '';
    try {
      streamPort.postMessage({
        sessionId: thisSessionId,
        type: 'ASK_ZO',
        pageContext: currentContext,
        userQuery: effectiveQuery,
        modelName: config.selectedModel || undefined,
        personaId: config.selectedPersona || undefined,
        modeId,
        customModes,
      });
    } catch (e) {
      // Port disconnected between check and postMessage — fall through to non-streaming fallback
      streamSession.active = false;
      streamPort = null;
    }
    if (streamPort) {
      // Response arrives via handleStreamMessage — input re-enabled there
      return;
    }
  }

  // --- Fallback: one-shot sendMessage if port unavailable ---
  const resp = await chrome.runtime.sendMessage({
    type: 'ASK_ZO',
    pageContext: currentContext,
    userQuery: effectiveQuery,
    modelName: config.selectedModel || undefined,
    personaId: config.selectedPersona || undefined,
    modeId,
    customModes,
  });

  const thinking = msgsEl.querySelector('.msg-thinking');
  if (thinking) thinking.remove();
  streamSession.active = false;

  if (!resp || resp.error) {
    addMessage('error', (!resp ? 'No response from background. Try reloading the extension.' : resp.error));
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    return;
  }

  const output = resp.output;
  let reasoning = '';
  let actions = [];

  // Normalize undefined/null/boolean to string for consistent parsing
  const normalizedOutput = (typeof output === 'object' && output !== null) ? output : String(output ?? '');

  if (typeof normalizedOutput === 'object' && normalizedOutput !== null) {
    reasoning = normalizedOutput.reasoning || '';
    actions = normalizeActions(normalizedOutput.actions);
  } else if (typeof normalizedOutput === 'string') {
    try {
      const parsed = JSON.parse(normalizedOutput);
      reasoning = parsed.reasoning || '';
      actions = normalizeActions(parsed.actions);
    } catch {
      reasoning = normalizedOutput;
    }
  }

  const doneAction = actions.find(a => a.type === 'done');
  const hasNavigate = actions.some(a => a.type === 'navigate');
  const doneResponse = doneAction?.response || '';
  const reasoningVal = safeText(reasoning) || undefined;

  if (!actions.length) {
    // Show reasoning or the raw output text, with "Done." only as last resort
    const fallbackText = reasoning || doneResponse || output || '';
    const el = addMessage('assistant', fallbackText || 'Done.');
    addReasoningBubble(el, reasoning);
  } else {
    handleStreamActions(actions, reasoning);
    // handleStreamActions already adds the done response for navigate actions
    // (via its own setTimeout). For non-navigate scenarios, display it here.
    if (doneAction && !hasNavigate) {
      const el = addMessage('assistant', doneResponse || reasoning || output || 'Done.');
      addReasoningBubble(el, reasoning);
    } else if (reasoningVal) {
      // navigate-only actions: persist reasoning with the navigate status message
      const conv = getActiveConversation();
      const last = conv?.messages?.[conv.messages.length - 1];
      if (last && last.role === 'assistant') last.reasoning = reasoningVal;
    }
  }

  // Persist reasoning on the most recent assistant message (addMessage pushed it
  // without reasoning, since reasoning isn't threaded through every caller).
  if (reasoningVal) {
    const conv = getActiveConversation();
    const last = conv?.messages?.[conv.messages.length - 1];
    if (last && last.role === 'assistant' && !last.reasoning) last.reasoning = reasoningVal;
  }

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
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
