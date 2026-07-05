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
  const apiUrlInput = document.getElementById('api-url');
  const spaceEndpointInput = document.getElementById('space-endpoint');
  const personaSelect = document.getElementById('persona-select');
  const modelStatus = document.getElementById('model-status');
  const themeSelect = document.getElementById(OPTIONS_THEME_SELECTOR);

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

  // Load config
  chrome.storage.sync.get([
    'zoAccessToken', 'zoApiUrl', 'zoModel', 'zoSpaceEndpoint', 'zoPersonaId', 'zoQuickActions'
  ], (result) => {
    if (result.zoAccessToken) tokenInput.value = result.zoAccessToken;
    if (result.zoApiUrl) apiUrlInput.value = result.zoApiUrl;
    if (result.zoSpaceEndpoint) spaceEndpointInput.value = result.zoSpaceEndpoint;
    if (result.zoPersonaId) personaSelect.value = result.zoPersonaId;
    quickActions = result.zoQuickActions || [];
    renderQuickActionsEditor();
    if (result.zoAccessToken) populateModels(tokenInput.value, result.zoModel);
    if (result.zoAccessToken) populatePersonas(tokenInput.value, personaSelect);
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
      statusMsg.className = 'status-message error';
      return;
    }
    chrome.storage.sync.set({
      zoAccessToken: token,
      zoApiUrl: apiUrlInput.value.trim() || 'https://api.zo.computer/zo/ask',
      zoModel: getModelValue(),
      zoSpaceEndpoint: spaceEndpointInput.value.trim() || 'https://cashlessconsumer.zo.space',
      zoPersonaId: personaSelect.value,
      zoQuickActions: quickActions,
    }, () => {
      statusMsg.textContent = '✅ Saved!';
      statusMsg.className = 'status-message success';
      setTimeout(() => { statusMsg.textContent = ''; statusMsg.className = 'status-message'; }, 3000);
    });
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      statusMsg.textContent = 'Enter an access token first.';
      statusMsg.className = 'status-message error';
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    statusMsg.textContent = 'Testing…';
    statusMsg.className = 'status-message';
    try {
      const r = await fetch(apiUrlInput.value.trim() || 'https://api.zo.computer/zo/ask', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ input: 'Reply with just: ZO_OK' }),
      });
      const text = await r.text();
      if (r.ok && text.includes('ZO_OK')) {
        statusMsg.textContent = '✅ Connection successful!';
        statusMsg.className = 'status-message success';
      } else {
        statusMsg.textContent = `⚠️ API returned ${r.status}`;
        statusMsg.className = 'status-message error';
      }
    } catch (err) {
      statusMsg.textContent = `❌ ${err.message}`;
      statusMsg.className = 'status-message error';
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

async function populatePersonas(token, personaSelect) {
  try {
    const r = await fetch('https://api.zo.computer/personas/available', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.personas?.length) return;
    personaSelect.innerHTML = '<option value="">Zo (default)</option>';
    for (const p of data.personas) {
      const opt = document.createElement('option');
      opt.value = p.id || '';
      opt.textContent = p.name || p.id || '';
      personaSelect.appendChild(opt);
    }
  } catch { /* ignore */ }
}
