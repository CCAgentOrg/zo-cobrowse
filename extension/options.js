// Zo Co-browse — Options / Settings Logic

const $ = (sel) => document.querySelector(sel);

// ---- Theme ----
const THEME_STORAGE_KEY = 'cobrowse_theme';

function loadOptionsTheme() {
  chrome.storage.sync.get(THEME_STORAGE_KEY, (result) => {
    const theme = result[THEME_STORAGE_KEY] || '';
    const effective = theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', effective);
  });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadOptionsTheme();
  // Listen for system theme changes when no override is set
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', loadOptionsTheme);

  const form = document.getElementById('settings-form');
  const saveBtn = form.querySelector('.btn-primary');
  const testBtn = document.getElementById('test-btn');
  const statusMsg = document.getElementById('status-message');
  const tokenInput = document.getElementById('access-token');
  const apiUrlInput = document.getElementById('api-url');
  const modelInput = document.getElementById('model');
  const spaceEndpointInput = document.getElementById('space-endpoint');
  const personaSelect = document.getElementById('persona-select');
  const modelStatus = document.getElementById('model-status');
  const quickActionsArea = document.getElementById('quick-actions-area');
  const themeBtn = document.getElementById('options-theme-toggle');

  // Theme toggle
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      chrome.storage.sync.get(THEME_STORAGE_KEY, (result) => {
        const current = result[THEME_STORAGE_KEY] || '';
        const next = current === 'light' ? 'dark' : 'light';
        chrome.storage.sync.set({ [THEME_STORAGE_KEY]: next }, () => {
          document.documentElement.setAttribute('data-theme', next);
          themeBtn.textContent = next === 'light' ? '☾' : '☀';
        });
      });
    });
  }

  // Quick Actions management
  let quickActions = [];

  function renderQuickActionsEditor() {
    quickActionsArea.innerHTML = '';
    const actions = quickActions.length ? quickActions : [{ label: '', prompt: '' }];
    actions.forEach((action, i) => {
      const row = document.createElement('div');
      row.className = 'qa-row';
      row.innerHTML = `
        <input type="text" class="qa-label" placeholder="Label" value="${escapeHtml(action.label)}" data-index="${i}" />
        <input type="text" class="qa-prompt" placeholder="Prompt" value="${escapeHtml(action.prompt)}" data-index="${i}" />
        <button class="qa-remove" data-index="${i}" ${actions.length === 1 ? 'disabled' : ''}>✕</button>
      `;
      quickActionsArea.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Support for the legacy fixed options
  const legacyTab = document.querySelector('.legacy-options');
  if (legacyTab) legacyTab.style.display = 'none';

  // Load config
  chrome.storage.sync.get([
    'zoAccessToken', 'zoApiUrl', 'zoModel', 'zoSpaceEndpoint', 'zoPersonaId', 'zoQuickActions'
  ], (result) => {
    if (result.zoAccessToken) tokenInput.value = result.zoAccessToken;
    if (result.zoApiUrl) apiUrlInput.value = result.zoApiUrl;
    if (result.zoModel) modelInput.value = result.zoModel;
    if (result.zoSpaceEndpoint) spaceEndpointInput.value = result.zoSpaceEndpoint;
    if (result.zoPersonaId) personaSelect.value = result.zoPersonaId;
    quickActions = result.zoQuickActions || [];
    renderQuickActionsEditor();
    if (result.zoAccessToken) populateModels(tokenInput.value, modelInput, modelStatus);
    if (result.zoAccessToken) populatePersonas(tokenInput.value, personaSelect);
  });

  // Token change → fetch models
  tokenInput.addEventListener('change', () => {
    const token = tokenInput.value.trim();
    if (token) populateModels(token, modelInput, modelStatus);
  });

  // Quick Actions live editing
  quickActionsArea.addEventListener('input', (e) => {
    const index = parseInt(e.target.dataset.index);
    if (isNaN(index)) return;
    const labels = quickActionsArea.querySelectorAll('.qa-label');
    const prompts = quickActionsArea.querySelectorAll('.qa-prompt');
    const actions = [];
    labels.forEach((l, i) => {
      const label = l.value.trim();
      const prompt = prompts[i]?.value?.trim() || '';
      if (label && prompt) actions.push({ label, prompt });
    });
    quickActions = actions;
    chrome.storage.sync.set({ zoQuickActions: quickActions });
  });

  quickActionsArea.addEventListener('click', (e) => {
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
  saveBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      statusMsg.textContent = 'Access token is required.';
      statusMsg.className = 'status-message error';
      return;
    }
    chrome.storage.sync.set({
      zoAccessToken: token,
      zoApiUrl: apiUrlInput.value.trim() || 'https://api.zo.computer/zo/ask',
      zoModel: modelInput.value.trim(),
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

async function populateModels(token, modelInput, modelStatus) {
  modelStatus.textContent = 'Loading models…';
  try {
    const r = await fetch('https://api.zo.computer/models/available', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { modelStatus.textContent = 'Could not fetch models'; return; }
    const data = await r.json();
    if (!data.models?.length) { modelStatus.textContent = 'No models returned'; return; }
    const current = modelInput.value;
    // Build datalist-like dropdown via <select>
    const select = document.createElement('select');
    select.id = 'model';
    select.className = modelInput.className;
    select.style.cssText = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;';
    select.innerHTML = '<option value="">Default model</option>';
    for (const m of data.models) {
      const opt = document.createElement('option');
      opt.value = m.model_name || '';
      opt.textContent = `${m.label || m.model_name || ''}${m.vendor ? ` (${m.vendor})` : ''}`;
      if (opt.value === current) opt.selected = true;
      select.appendChild(opt);
    }
    modelInput.replaceWith(select);
    modelStatus.textContent = `${data.models.length} models loaded`;
    select.addEventListener('change', () => {
      chrome.storage.sync.set({ zoModel: select.value });
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
