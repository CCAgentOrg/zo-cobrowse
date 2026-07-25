// Zo Co-browse — Options / Settings Logic

const $ = (sel) => document.querySelector(sel);

// ---- Theme ----
const THEME_STORAGE_KEY = 'cobrowse_theme';
const OPTIONS_THEME_SELECTOR = 'options-theme';

// Theme names indexed by value (empty = system)
const THEME_NAMES = {
  '': 'System',
  'dark': 'Observatory Dark',
  'light': 'Observatory Light',
  'sepia': 'Sepia',
  'forest': 'Forest',
  'ocean': 'Ocean',
};

function loadOptionsTheme() {
  chrome.storage.sync.get(THEME_STORAGE_KEY, (result) => {
    const theme = result[THEME_STORAGE_KEY] || '';
    const effective = theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', effective);
    const sel = document.getElementById(OPTIONS_THEME_SELECTOR);
    if (sel) sel.value = theme;
  });
}

function applyOptionsTheme(theme) {
  const effective = theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', effective);
  chrome.storage.sync.set({ [THEME_STORAGE_KEY]: theme });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadOptionsTheme();
  // Listen for system theme changes when no override is set
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', loadOptionsTheme);

  const form = document.getElementById('settings-form');
  const testBtn = document.getElementById('test-btn');
  const statusMsg = document.getElementById('status-message');
  const tokenInput = document.getElementById('access-token');
  const spaceEndpointInput = document.getElementById('space-endpoint');
  const modelStatus = document.getElementById('model-status');
  const themeSelect = document.getElementById(OPTIONS_THEME_SELECTOR);

  // Persona routing fields
  const litePersonaSelect = document.getElementById('lite-persona-select');
  const fullPersonaSelect = document.getElementById('full-persona-select');
  const personaModeSelect = document.getElementById('persona-mode');

  // Theme selector
  if (themeSelect) {
    themeSelect.addEventListener('change', () => applyOptionsTheme(themeSelect.value));
  }

  // Quick Actions management
  let quickActions = [];

  function getModelValue() {
    const el = document.getElementById('model');
    return el ? el.value : '';
  }

  function getModelEl() {
    return document.getElementById('model');
  }

  function renderQuickActionsEditor() {
    const area = document.getElementById('quick-actions-list');
    if (!area) return;
    area.innerHTML = '';
    const actions = quickActions.length ? quickActions : [{ label: '', prompt: '' }];
    actions.forEach((action, i) => {
      const row = document.createElement('div');
      row.className = 'qa-row';
      row.innerHTML = `
        <input type="text" class="qa-label" placeholder="Label" value="${escapeHtml(action.label)}" data-index="${i}" />
        <input type="text" class="qa-prompt" placeholder="Prompt" value="${escapeHtml(action.prompt)}" data-index="${i}" />
        <button class="qa-remove" data-index="${i}" ${actions.length === 1 ? 'disabled' : ''}>✕</button>
      `;
      area.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Load config — sensitive fields from storage.local, rest from storage.sync
  chrome.storage.local.get(['zoAccessToken', 'zoSpaceEndpoint'], (localResult) => {
    chrome.storage.sync.get([
      'zoModel', 'zoPersonaId', 'zoLitePersonaId', 'zoFullPersonaId', 'personaMode',
      'zoQuickActions',
      'zoTtsLang', 'zoTtsRate', 'zoTtsAutoRead', 'enabledMenus', 'enableScreenshots'
    ], (syncResult) => {
      const token = localResult.zoAccessToken;
      const spaceEndpoint = localResult.zoSpaceEndpoint;
      if (token) tokenInput.value = token;
      if (spaceEndpoint) spaceEndpointInput.value = spaceEndpoint;

      // Persona routing — load both personas with backward compat
      const liteId = syncResult.zoLitePersonaId || syncResult.zoPersonaId || '';
      const fullId = syncResult.zoFullPersonaId || syncResult.zoPersonaId || '';
      litePersonaSelect.value = liteId;
      fullPersonaSelect.value = fullId;
      if (syncResult.personaMode) personaModeSelect.value = syncResult.personaMode;

      quickActions = syncResult.zoQuickActions || [];
      renderQuickActionsEditor();
      if (token) populateModels(token, syncResult.zoModel);
      if (token) populatePersonas(token, litePersonaSelect, fullPersonaSelect, liteId, fullId);

      // Restore TTS fields
      const langInput = document.getElementById('tts-lang');
      const rateInput = document.getElementById('tts-rate');
      const autoReadCheck = document.getElementById('tts-auto-read');
      if (langInput) langInput.value = syncResult.zoTtsLang || 'en-US';
      if (rateInput) rateInput.value = syncResult.zoTtsRate || '1.0';
      if (autoReadCheck) autoReadCheck.checked = syncResult.zoTtsAutoRead || false;

      // Restore screenshot toggle
      const screenshotsCheck = document.getElementById('enable-screenshots');
      if (screenshotsCheck) screenshotsCheck.checked = syncResult.enableScreenshots !== false;
    });
  });

  // Token change → fetch models
  tokenInput.addEventListener('change', () => {
    const token = tokenInput.value.trim();
    if (token) populateModels(token, getModelValue());
  });

  // Quick Actions live editing
  document.getElementById('quick-actions-list')?.addEventListener('input', (e) => {
    const index = parseInt(e.target.dataset.index);
    if (isNaN(index)) return;
    const labels = document.querySelectorAll('.qa-label');
    const prompts = document.querySelectorAll('.qa-prompt');
    const actions = [];
    labels.forEach((l, i) => {
      const label = l.value.trim();
      const prompt = prompts[i]?.value?.trim() || '';
      if (label && prompt) actions.push({ label, prompt });
    });
    quickActions = actions;
    chrome.storage.sync.set({ zoQuickActions: quickActions });
  });

  document.getElementById('quick-actions-list')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('qa-remove')) {
      const index = parseInt(e.target.dataset.index);
      if (!isNaN(index)) {
        quickActions.splice(index, 1);
        chrome.storage.sync.set({ zoQuickActions: quickActions });
        renderQuickActionsEditor();
      }
    }
  });

  // "Add row" button
  const addRowBtn = document.getElementById('add-qa-row');
  if (addRowBtn) {
    addRowBtn.addEventListener('click', () => {
      quickActions.push({ label: '', prompt: '' });
      renderQuickActionsEditor();
    });
  }

  // Save
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      statusMsg.textContent = 'Access token is required.';
      statusMsg.className = 'inline-status err';
      return;
    }
    // Store sensitive data separately in storage.local (not synced across devices)
    chrome.storage.local.set({
      zoAccessToken: token,
      zoSpaceEndpoint: spaceEndpointInput.value.trim() || 'https://cashlessconsumer.zo.space',
    }, () => {
      // Non-sensitive config stays in storage.sync
      chrome.storage.sync.set({
        zoModel: getModelValue(),
        zoPersonaId: litePersonaSelect.value,
        zoLitePersonaId: litePersonaSelect.value,
        zoFullPersonaId: fullPersonaSelect.value,
        personaMode: personaModeSelect.value,
        zoQuickActions: quickActions,
        zoTtsLang: (document.getElementById('tts-lang')?.value || 'en-US').trim(),
        zoTtsRate: (document.getElementById('tts-rate')?.value || '1.0').trim(),
        zoTtsAutoRead: !!(document.getElementById('tts-auto-read')?.checked),
        enableScreenshots: !!(document.getElementById('enable-screenshots')?.checked),
      enabledMenus: {
        page: document.getElementById('menu-ask-page')?.checked ?? true,
        selection: document.getElementById('menu-ask-selection')?.checked ?? true,
        link: document.getElementById('menu-ask-link')?.checked ?? true,
        editable: document.getElementById('menu-fill-editable')?.checked ?? false,
      },
      }, () => {
        statusMsg.textContent = '✅ Saved!';
        statusMsg.className = 'inline-status ok';
        setTimeout(() => { statusMsg.textContent = ''; statusMsg.className = 'inline-status'; }, 3000);
      });
    });
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      statusMsg.textContent = 'Enter an access token first.';
      statusMsg.className = 'inline-status err';
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    statusMsg.textContent = 'Testing…';
    statusMsg.className = 'inline-status pending';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const r = await fetch(DEFAULTS.zoApiUrl, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: 'Reply with just: ZO_OK' }),
      });
      clearTimeout(timeout);
      const text = await r.text();
      if (r.ok && text.includes('ZO_OK')) {
        statusMsg.textContent = '✅ Connection successful!';
        statusMsg.className = 'inline-status ok';
      } else {
        statusMsg.textContent = `⚠️ API returned ${r.status}`;
        statusMsg.className = 'inline-status err';
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        statusMsg.textContent = '❌ Request timed out after 15s. Check your token and internet.';
      } else {
        statusMsg.textContent = `❌ ${err.message}`;
      }
      statusMsg.className = 'inline-status err';
    }
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  });

  // Quick nav to Zo settings
  const goToZoBtn = document.getElementById('go-to-zo-settings');
  if (goToZoBtn) {
    goToZoBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://cashlessconsumer.zo.computer/?t=settings&s=advanced' });
    });
  }
});

async function populateModels(token, currentValue) {
  const modelStatus = document.getElementById('model-status');
  const container = document.getElementById('model');
  if (!container || !modelStatus) return;
  modelStatus.textContent = 'Loading models…';
  try {
    const r = await fetch('https://api.zo.computer/models/available', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { modelStatus.textContent = 'Could not fetch models'; return; }
    const data = await r.json();
    if (!data.models?.length) { modelStatus.textContent = 'No models returned'; return; }
    // Replace the inner HTML of the existing select rather than replacing the node
    // This preserves the reference that getElementById('model') returns
    container.innerHTML = '<option value="">Default model</option>';
    for (const m of data.models) {
      const opt = document.createElement('option');
      opt.value = m.model_name || '';
      opt.textContent = `${m.label || m.model_name || ''}${m.vendor ? ` (${m.vendor})` : ''}`;
      if (opt.value === currentValue) opt.selected = true;
      container.appendChild(opt);
    }
    modelStatus.textContent = `${data.models.length} models loaded`;
    container.addEventListener('change', () => {
      chrome.storage.sync.set({ zoModel: container.value });
    });
  } catch {
    modelStatus.textContent = 'Error loading models';
  }
}

async function populatePersonas(token, liteSelect, fullSelect, liteId, fullId) {
  try {
    const r = await fetch('https://api.zo.computer/personas/available', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.personas?.length) return;
    liteSelect.innerHTML = '<option value="">Zo (default)</option>';
    fullSelect.innerHTML = '<option value="">Zo (default)</option>';
    for (const p of data.personas) {
      const opt = document.createElement('option');
      opt.value = p.id || '';
      opt.textContent = p.name || p.id || '';
      liteSelect.appendChild(opt);
      fullSelect.appendChild(opt);
    }
    liteSelect.value = liteId;
    fullSelect.value = fullId;
  } catch { /* ignore */ }
}
