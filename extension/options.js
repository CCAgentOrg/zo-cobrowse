// Zo Co-browse — Settings Page Logic

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

  // ---- Load saved settings ----
  const saved = await chrome.storage.sync.get([
    'zoApiUrl', 'zoAccessToken', 'zoModel', 'zoSpaceEndpoint',
    'zoAutoRun', 'zoCaptureScreenshots', 'zoConfirmNavigation', 'zoMaxTextLen',
  ]);

  if (saved.zoApiUrl) apiUrl.value = saved.zoApiUrl;
  if (saved.zoAccessToken) accessToken.value = saved.zoAccessToken;
  if (saved.zoModel) model.value = saved.zoModel;
  if (saved.zoSpaceEndpoint) spaceEndpoint.value = saved.zoSpaceEndpoint;
  if (saved.zoAutoRun !== undefined) autoRun.checked = saved.zoAutoRun;
  if (saved.zoCaptureScreenshots !== undefined) captureScreenshots.checked = saved.zoCaptureScreenshots;
  if (saved.zoConfirmNavigation !== undefined) confirmNavigation.checked = saved.zoConfirmNavigation;
  if (saved.zoMaxTextLen) maxTextLen.value = String(saved.zoMaxTextLen);

  // ---- Toggle token visibility ----
  toggleToken.addEventListener('click', () => {
    accessToken.type = accessToken.type === 'password' ? 'text' : 'password';
    toggleToken.textContent = accessToken.type === 'password' ? '👁' : '🙈';
  });

  // ---- Save ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    await chrome.storage.sync.set({
      zoApiUrl: apiUrl.value.trim(),
      zoAccessToken: accessToken.value.trim(),
      zoModel: model.value.trim() || 'byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc',
      zoSpaceEndpoint: spaceEndpoint.value.trim(),
      zoAutoRun: autoRun.checked,
      zoCaptureScreenshots: captureScreenshots.checked,
      zoConfirmNavigation: confirmNavigation.checked,
      zoMaxTextLen: parseInt(maxTextLen.value, 10),
    });

    showStatus('Settings saved.', 'success');
    // Broadcast to background script
    await chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' });
  });

  // ---- Test connection ----
  testBtn.addEventListener('click', async () => {
    testResults.classList.remove('hidden');
    testZoApi.textContent = '⏳ testing...';
    testZoSpace.textContent = '⏳ testing...';

    // Test Zo API
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

    // Test Zo.space
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

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status status-${type}`;
    setTimeout(() => statusMsg.classList.add('hidden'), 4000);
  }
});
