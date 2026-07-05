// Zo Co-browse — Settings Page Logic

const STORAGE_ACTIONS_KEY = 'zoQuickActions';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form');
  const apiUrl = document.getElementById('api-url');
  const accessToken = document.getElementById('access-token');
  const model = document.getElementById('model');
  const spaceEndpoint = document.getElementById('space-endpoint');
  const autoRun = document.getElementById('auto-run');
  const captureScreenshots = document.getElementById('capture-screenshots');
  const confirmNavigation = document.getElementById('confirm-navigation');
  const maxTextLen = document.getElementById('max-text-len');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const statusMsg = document.getElementById('status-message');
  const testResults = document.getElementById('test-results');
  const testZoApi = document.getElementById('test-zo-api');
  const testZoSpace = document.getElementById('test-zo-space');
  const toggleToken = document.getElementById('toggle-token');
  const qaList = document.getElementById('qa-list');
  const qaAddBtn = document.getElementById('qa-add-btn');

  // ---- Quick Actions state ----
  let quickActions = [];

  // ---- Load saved settings ----
  const saved = await chrome.storage.sync.get([
    'zoApiUrl', 'zoAccessToken', 'zoModel', 'zoSpaceEndpoint',
    'zoAutoRun', 'zoCaptureScreenshots', 'zoConfirmNavigation', 'zoMaxTextLen',
    STORAGE_ACTIONS_KEY,
  ]);

  if (saved.zoApiUrl) apiUrl.value = saved.zoApiUrl;
  if (saved.zoAccessToken) accessToken.value = saved.zoAccessToken;
  if (saved.zoModel) model.value = saved.zoModel;
  if (saved.zoSpaceEndpoint) spaceEndpoint.value = saved.zoSpaceEndpoint;
  if (saved.zoAutoRun !== undefined) autoRun.checked = saved.zoAutoRun;
  if (saved.zoCaptureScreenshots !== undefined) captureScreenshots.checked = saved.zoCaptureScreenshots;
  if (saved.zoConfirmNavigation !== undefined) confirmNavigation.checked = saved.zoConfirmNavigation;
  if (saved.zoMaxTextLen) maxTextLen.value = String(saved.zoMaxTextLen);

  // Load quick actions (with defaults)
  quickActions = saved[STORAGE_ACTIONS_KEY] || [
    { label: 'Summarize', prompt: 'Summarize this page in 3-5 bullet points.' },
    { label: 'Extract links', prompt: 'Extract all links from this page.' },
    { label: 'Fill forms', prompt: 'Identify all form fields on this page and fill them with relevant test data.' },
    { label: 'Page data', prompt: 'Extract all structured data (tables, lists, prices, dates, contacts) from this page.' },
  ];
  renderQuickActions();

  // ---- Toggle token visibility ----
  toggleToken.addEventListener('click', () => {
    accessToken.type = accessToken.type === 'password' ? 'text' : 'password';
    toggleToken.textContent = accessToken.type === 'password' ? '👁' : '🙈';
  });

  // ---- Quick Action CRUD ----

  qaAddBtn.addEventListener('click', () => {
    quickActions.push({ label: '', prompt: '' });
    renderQuickActions();
    // Focus the last label input
    const inputs = qaList.querySelectorAll('.qa-label');
    const last = inputs[inputs.length - 1];
    if (last) setTimeout(() => last.focus(), 50);
  });

  function renderQuickActions() {
    qaList.innerHTML = '';
    if (quickActions.length === 0) {
      qaList.innerHTML = '<div class="qa-empty">No quick actions defined. Add one to show chips in the sidepanel.</div>';
      return;
    }
    for (let i = 0; i < quickActions.length; i++) {
      const item = quickActions[i];
      const row = document.createElement('div');
      row.className = 'qa-row';
      row.dataset.index = i;

      const grip = document.createElement('span');
      grip.className = 'qa-grip';
      grip.textContent = '⠿';

      const labelInp = document.createElement('input');
      labelInp.type = 'text';
      labelInp.className = 'qa-label';
      labelInp.placeholder = 'Button label (e.g. Summarize)';
      labelInp.value = item.label;
      labelInp.addEventListener('input', () => { quickActions[i].label = labelInp.value; markDirty(); });

      const promptInp = document.createElement('input');
      promptInp.type = 'text';
      promptInp.className = 'qa-prompt';
      promptInp.placeholder = 'Prompt sent to Zo when clicked';
      promptInp.value = item.prompt;
      promptInp.addEventListener('input', () => { quickActions[i].prompt = promptInp.value; markDirty(); });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'qa-del';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove this quick action';
      delBtn.addEventListener('click', () => {
        quickActions.splice(i, 1);
        renderQuickActions();
        markDirty();
      });

      row.appendChild(grip);
      row.appendChild(labelInp);
      row.appendChild(promptInp);
      row.appendChild(delBtn);
      qaList.appendChild(row);
    }
  }

  // ---- Save ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Filter out empty rows
    const valid = quickActions.filter(a => a.label.trim() && a.prompt.trim());

    await chrome.storage.sync.set({
      zoApiUrl: apiUrl.value.trim(),
      zoAccessToken: accessToken.value.trim(),
      zoModel: model.value.trim() || 'byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc',
      zoSpaceEndpoint: spaceEndpoint.value.trim(),
      zoAutoRun: autoRun.checked,
      zoCaptureScreenshots: captureScreenshots.checked,
      zoConfirmNavigation: confirmNavigation.checked,
      zoMaxTextLen: parseInt(maxTextLen.value, 10),
      [STORAGE_ACTIONS_KEY]: valid,
    });

    showStatus('Settings saved.', 'success');
    dirty = false;
    // Broadcast to background script
    await chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' });
  });

  // ---- Test connection ----
  testBtn.addEventListener('click', async () => {
    testResults.classList.remove('hidden');
    testZoApi.textContent = '⏳ testing...';
    testZoSpace.textContent = '⏳ testing...';

    const token = accessToken.value.trim();
    const url = apiUrl.value.trim();
    const mdl = model.value.trim() || 'byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc';

    if (!token) {
      testZoApi.textContent = '✕ No token configured';
    } else {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            input: 'Respond with just the word "connected" if you receive this message.',
            model_name: mdl,
          }),
        });

        if (!resp.ok) {
          testZoApi.textContent = `✕ HTTP ${resp.status}`;
          testZoApi.title = await resp.text();
        } else {
          const data = await resp.json();
          testZoApi.textContent = `✓ ${String(data.output).trim().substring(0, 80)}`;
        }
      } catch (err) {
        testZoApi.textContent = `✕ ${err.message}`;
      }
    }

    const space = spaceEndpoint.value.trim();
    if (space) {
      try {
        const resp = await fetch(space, { method: 'HEAD' });
        testZoSpace.textContent = `✓ HTTP ${resp.status}`;
      } catch (err) {
        testZoSpace.textContent = `✕ ${err.message}`;
      }
    }
  });

  let dirty = false;
  function markDirty() { dirty = true; }

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status status-${type}`;
    setTimeout(() => statusMsg.classList.add('hidden'), 4000);
  }
});
