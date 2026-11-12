const api = window.localPill || window.electronAPI;

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    tabContents.forEach((c) => (c.style.display = 'none'));

    btn.classList.add('active');
    const tabId = `tab-${btn.dataset.tab}`;
    const target = document.getElementById(tabId);
    if (target) target.style.display = 'block';
  });
});

// Engine selection logic
const engineRadios = document.querySelectorAll('input[name="engine"]');
const groqGroup = document.getElementById('groqGroup');
const groqApiKeyInput = document.getElementById('groqApiKey');
const gnaniGroup = document.getElementById('gnaniGroup');
const gnaniApiKeyInput = document.getElementById('gnaniApiKey');
const speechLanguageSelect = document.getElementById('speechLanguage');
const scriptModeSelect = document.getElementById('scriptMode');

function updateEngineKeyVisibility(engineValue) {
  if (groqGroup) groqGroup.style.display = engineValue === 'groq-whisper' ? 'block' : 'none';
  if (gnaniGroup) gnaniGroup.style.display = engineValue === 'gnani-prisma' ? 'block' : 'none';
}

engineRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    updateEngineKeyVisibility(radio.value);
  });
});

// Snippets state
let snippetsMap = {};

function renderSnippets() {
  const container = document.getElementById('snippetList');
  container.innerHTML = '';

  for (const [trigger, expansion] of Object.entries(snippetsMap)) {
    const item = document.createElement('div');
    item.className = 'snippet-item';

    const triggerEl = document.createElement('span');
    triggerEl.className = 'snippet-trigger';
    triggerEl.textContent = trigger;

    const expansionEl = document.createElement('span');
    expansionEl.className = 'snippet-expansion';
    expansionEl.textContent = expansion;

    const delBtn = document.createElement('button');
    delBtn.className = 'snippet-delete-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Remove snippet';
    delBtn.addEventListener('click', () => {
      delete snippetsMap[trigger];
      renderSnippets();
    });

    item.appendChild(triggerEl);
    item.appendChild(expansionEl);
    item.appendChild(delBtn);
    container.appendChild(item);
  }
}

document.getElementById('addSnippetBtn').addEventListener('click', () => {
  const triggerInput = document.getElementById('newTrigger');
  const expansionInput = document.getElementById('newExpansion');
  const trigger = triggerInput.value.trim();
  const expansion = expansionInput.value.trim();

  if (trigger && expansion) {
    snippetsMap[trigger] = expansion;
    triggerInput.value = '';
    expansionInput.value = '';
    renderSnippets();
  }
});

// Load settings
// Load settings & telemetry
async function loadSettings() {
  if (!api || !api.getSettings) return;

  const s = await api.getSettings();
  if (!s) return;

  // Engine & Language
  const selectedEngineRadio = document.querySelector(`input[name="engine"][value="${s.engine}"]`);
  if (selectedEngineRadio) {
    selectedEngineRadio.checked = true;
  }
  updateEngineKeyVisibility(s.engine || 'whisper-base');

  if (groqApiKeyInput) groqApiKeyInput.value = s.groqApiKey || '';
  if (gnaniApiKeyInput) gnaniApiKeyInput.value = s.gnaniApiKey || '';
  if (speechLanguageSelect) speechLanguageSelect.value = s.speechLanguage || 'en';
  if (scriptModeSelect) scriptModeSelect.value = s.scriptMode || 'romanized';

  // Assistant & Memory
  const assistantCheck = document.getElementById('assistantEnabled');
  const memoryCheck = document.getElementById('memoryEnabled');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const screenshotFolderInput = document.getElementById('screenshotFolder');

  if (assistantCheck) assistantCheck.checked = s.assistantEnabled !== false;
  if (memoryCheck) memoryCheck.checked = s.memoryEnabled !== false;
  if (geminiApiKeyInput) geminiApiKeyInput.value = s.geminiApiKey || '';
  if (screenshotFolderInput) screenshotFolderInput.value = s.screenshotFolder || '';

  const memoryModeSelect = document.getElementById('memoryMode');
  if (memoryModeSelect) memoryModeSelect.value = s.memoryMode || 'hybrid';

  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  if (chooseFolderBtn) {
    chooseFolderBtn.onclick = async () => {
      if (api.chooseFolder) {
        const folder = await api.chooseFolder();
        if (folder) {
          screenshotFolderInput.value = folder;
        }
      }
    };
  }

  const clearMemoryBtn = document.getElementById('clearMemoryBtn');
  const clearMemoryStatus = document.getElementById('clearMemoryStatus');
  if (clearMemoryBtn) {
    clearMemoryBtn.onclick = async () => {
      if (api.clearMemory) {
        if (clearMemoryStatus) clearMemoryStatus.textContent = 'Clearing index...';
        await api.clearMemory();
        if (clearMemoryStatus) clearMemoryStatus.textContent = 'Memory index cleared (0 / 25).';
        const countEl = document.getElementById('memoryItemCount');
        if (countEl) countEl.textContent = '0 / 25 screenshots';
        setTimeout(() => {
          if (clearMemoryStatus) clearMemoryStatus.textContent = 'Wipes index slots without deleting your actual files.';
        }, 3000);
      }
    };
  }

  // Refresh assistant status
  try {
    if (api.getAssistantStatus) {
      const ast = await api.getAssistantStatus();
      const countEl = document.getElementById('memoryItemCount');
      const watcherEl = document.getElementById('watcherStatus');
      const folderEl = document.getElementById('memoryFolderPath');

      if (countEl) countEl.textContent = `${ast?.indexedCount ?? 0} / 25 screenshots`;
      if (watcherEl) watcherEl.textContent = ast?.watching ? 'Watching' : 'Idle';
      if (folderEl) folderEl.textContent = ast?.folder || 'Default';
    }
  } catch (_) {}

  // Pipeline
  const p = s.textPipeline || {};
  document.getElementById('spokenPunctuation').checked = p.spokenPunctuation !== false;
  document.getElementById('fillerRemoval').checked = p.fillerRemoval !== false;
  document.getElementById('casing').checked = p.casing !== false;

  // Snippets
  snippetsMap = { ...(s.snippets || {}) };
  renderSnippets();

  // General
  document.getElementById('hotkeyInput').value = s.hotkey || 'CommandOrControl+Shift+Space';
  document.getElementById('logTranscripts').checked = Boolean(s.logTranscripts);

  // Update telemetry
  const activeEngineEl = document.getElementById('telemetryActive');
  const deviceEl = document.getElementById('telemetryDevice');
  const loadTimeEl = document.getElementById('telemetryLoadTime');

  if (activeEngineEl) activeEngineEl.textContent = s.engine || 'whisper-base';

  try {
    if (api.listEngines) {
      const engines = await api.listEngines();
      const activeObj = engines.find((e) => e.is_active || e.id === s.engine);
      if (activeObj) {
        if (deviceEl) deviceEl.textContent = `${activeObj.device.toUpperCase()} (${activeObj.compute_type})`;
      }
    }
  } catch (_) {}

  // Load MCP info & configuration templates
  try {
    if (api && api.getMcpInfo) {
      const info = await api.getMcpInfo();
      const mcpDirInput = document.getElementById('mcpAllowedDir');
      if (mcpDirInput) mcpDirInput.value = info.allowedDir || '';

      const claudeConfig = {
        mcpServers: {
          'localpill-speech': {
            command: 'npx',
            args: ['-y', 'mcp-remote', info.speechEndpoint || 'http://localhost:8085/mcp'],
          },
          'localpill-text': {
            command: 'npx',
            args: ['-y', 'mcp-remote', info.textEndpoint || 'http://localhost:8095/mcp'],
          },
        },
      };

      const antigravityConfig = {
        mcpServers: {
          'localpill-speech': {
            serverUrl: info.speechEndpoint || 'http://localhost:8085/mcp',
          },
          'localpill-text': {
            serverUrl: info.textEndpoint || 'http://localhost:8095/mcp',
          },
        },
      };

      const claudeCodeEl = document.getElementById('claudeConfigCode');
      if (claudeCodeEl) claudeCodeEl.textContent = JSON.stringify(claudeConfig, null, 2);

      const agyCodeEl = document.getElementById('antigravityConfigCode');
      if (agyCodeEl) agyCodeEl.textContent = JSON.stringify(antigravityConfig, null, 2);

      const openFolderBtn = document.getElementById('openMcpFolderBtn');
      if (openFolderBtn) {
        openFolderBtn.onclick = () => {
          if (api.openMcpAllowedDir) api.openMcpAllowedDir();
        };
      }

      const copyFolderBtn = document.getElementById('copyMcpFolderBtn');
      if (copyFolderBtn) {
        copyFolderBtn.onclick = () => {
          navigator.clipboard.writeText(info.allowedDir || '');
          copyFolderBtn.textContent = 'Copied!';
          setTimeout(() => (copyFolderBtn.textContent = 'Copy Path'), 1500);
        };
      }

      const copyClaudeBtn = document.getElementById('copyClaudeConfigBtn');
      if (copyClaudeBtn) {
        copyClaudeBtn.onclick = () => {
          navigator.clipboard.writeText(JSON.stringify(claudeConfig, null, 2));
          copyClaudeBtn.textContent = 'Copied!';
          setTimeout(() => (copyClaudeBtn.textContent = 'Copy Claude Config'), 1500);
        };
      }

      const copyAgyBtn = document.getElementById('copyAntigravityConfigBtn');
      if (copyAgyBtn) {
        copyAgyBtn.onclick = () => {
          navigator.clipboard.writeText(JSON.stringify(antigravityConfig, null, 2));
          copyAgyBtn.textContent = 'Copied!';
          setTimeout(() => (copyAgyBtn.textContent = 'Copy Antigravity Config'), 1500);
        };
      }
    }
  } catch (err) {
    console.warn('MCP Info load error:', err);
  }
}

// Save settings & live engine swap
document.getElementById('saveBtn').addEventListener('click', async () => {
  const selectedEngine = document.querySelector('input[name="engine"]:checked')?.value || 'whisper-base';

  const newSettings = {
    engine: selectedEngine,
    speechLanguage: speechLanguageSelect?.value || 'en',
    scriptMode: scriptModeSelect?.value || 'romanized',
    groqApiKey: groqApiKeyInput?.value.trim() || '',
    gnaniApiKey: gnaniApiKeyInput?.value.trim() || '',
    assistantEnabled: document.getElementById('assistantEnabled')?.checked !== false,
    memoryEnabled: document.getElementById('memoryEnabled')?.checked !== false,
    memoryMode: document.getElementById('memoryMode')?.value || 'hybrid',
    memoryMaxEntries: 25,
    geminiApiKey: document.getElementById('geminiApiKey')?.value.trim() || '',
    screenshotFolder: document.getElementById('screenshotFolder')?.value.trim() || '',
    hotkey: document.getElementById('hotkeyInput').value.trim(),
    transport: 'graft',
    logTranscripts: document.getElementById('logTranscripts').checked,
    textPipeline: {
      spokenPunctuation: document.getElementById('spokenPunctuation').checked,
      fillerRemoval: document.getElementById('fillerRemoval').checked,
      casing: document.getElementById('casing').checked,
    },
    snippets: snippetsMap,
  };

  const statusEl = document.getElementById('saveStatus');
  const loadTimeEl = document.getElementById('telemetryLoadTime');
  const activeEngineEl = document.getElementById('telemetryActive');
  const deviceEl = document.getElementById('telemetryDevice');

  try {
    statusEl.textContent = 'Saving & configuring engine…';
    statusEl.style.color = '#818cf8';
    if (loadTimeEl) loadTimeEl.textContent = 'Loading…';

    const t0 = Date.now();
    await api.saveSettings(newSettings);
    const elapsed = Date.now() - t0;

    if (activeEngineEl) activeEngineEl.textContent = selectedEngine;
    if (loadTimeEl) loadTimeEl.textContent = `${elapsed} ms`;
    statusEl.textContent = 'Settings saved successfully!';
    statusEl.style.color = '#10b981';

    // Refresh telemetry
    try {
      if (api.listEngines) {
        const engines = await api.listEngines();
        const activeObj = engines.find((e) => e.is_active || e.id === selectedEngine);
        if (activeObj && deviceEl) {
          deviceEl.textContent = `${activeObj.device.toUpperCase()} (${activeObj.compute_type})`;
        }
      }
    } catch (_) {}

    // Refresh assistant status
    try {
      if (api.getAssistantStatus) {
        const ast = await api.getAssistantStatus();
        const countEl = document.getElementById('memoryItemCount');
        const watcherEl = document.getElementById('watcherStatus');
        const folderEl = document.getElementById('memoryFolderPath');

        if (countEl) countEl.textContent = `${ast?.indexedCount ?? 0} screenshots`;
        if (watcherEl) watcherEl.textContent = ast?.watcherRunning ? 'Running' : 'Stopped';
        if (folderEl) folderEl.textContent = ast?.folder || 'Default';
      }
    } catch (_) {}

    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = '#ef4444';
  }
});

loadSettings();
