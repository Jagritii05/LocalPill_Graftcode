import { ipcMain, shell, clipboard, nativeImage, dialog, screen } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getSpeechClient } from './speech-client.js';
import { getTextClient } from './text-client.js';
import { pasteTextToActiveWindow } from './paste.js';
import { settingsStore } from './settings-store.js';
import { logger } from './logger.js';
import { translateError } from './graft/adapter.js';
import {
  detectIntent,
  findScreenshots,
  summarizeRecent,
  askAboutScreen,
  rememberCurrentScreen,
  askAboutRememberedScreen,
  hasActiveMemoryContext,
  clearMemoryStore,
  getMemoryStatus,
  startScreenshotWatcher,
} from './assistant/index.js';
import { transliterateToRoman } from './assistant/gemini.js';

export function registerIpcHandlers({ getPillWindow, openSettingsWindow }) {
  // Check backend health
  ipcMain.handle('speech:health', async () => {
    try {
      const client = getSpeechClient();
      return await client.isReady();
    } catch (err) {
      const trans = translateError(err);
      return { ready: false, error: trans.message, kind: trans.kind };
    }
  });

  // Audio transcription with auto-retry
  ipcMain.handle('speech:transcribe', async (_event, audioData) => {
    try {
      if (!audioData || audioData.length < 800) {
        return {
          success: false,
          error: "Didn't catch any audio. Try again.",
          kind: 'INVALID_AUDIO',
        };
      }

      const buffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData);
      logger.info(`Received audio data for transcription (${buffer.length} bytes).`);

      const speechClient = getSpeechClient();
      const speechLanguage = settingsStore.get('speechLanguage') || 'en';
      let rawResult = null;

      try {
        rawResult = await speechClient.transcribe(buffer, { language: speechLanguage });
      } catch (err) {
        const trans = translateError(err);
        logger.warn(`Speech transcription failed (Attempt 1): [${trans.kind}] ${trans.message}`);

        // One auto-retry on Gateway death or socket drop
        if (trans.kind === 'GATEWAY_DIED' || trans.kind === 'GATEWAY_NOT_READY') {
          logger.info('[Supervisor] Gateway died or restarting. Waiting 1.5s for auto-restart retry...');
          await new Promise((r) => setTimeout(r, 1500));
          try {
            rawResult = await speechClient.transcribe(buffer, { language: speechLanguage });
            logger.info('[Supervisor] Auto-retry succeeded after gateway restart!');
          } catch (retryErr) {
            const retryTrans = translateError(retryErr);
            return {
              success: false,
              error: 'Service restarted, please retry.',
              kind: 'GATEWAY_DIED',
            };
          }
        } else if (trans.kind === 'ENGINE_UNAVAILABLE') {
          const fallback = trans.fallback || 'whisper-base';
          logger.info(`[Supervisor] Engine unavailable. Attempting auto-fallback to ${fallback}...`);
          try {
            await speechClient.setEngine(fallback);
            rawResult = await speechClient.transcribe(buffer, { language: speechLanguage });
          } catch (fbErr) {
            return {
              success: false,
              error: trans.message,
              kind: trans.kind,
            };
          }
        } else {
          return {
            success: false,
            error: trans.message,
            kind: trans.kind,
          };
        }
      }

      logger.info(`Raw speech transcription complete: "${rawResult?.text || ''}"`);

      if (!rawResult || !rawResult.text || !rawResult.text.trim()) {
        return {
          success: true,
          text: '',
          rawText: '',
          message: "Didn't catch any audio. Try again.",
          duration: rawResult?.duration || 0,
          words: [],
          maskedCount: 0,
        };
      }

      // Run through text pipeline
      let cleanText = rawResult.text;
      try {
        const textClient = getTextClient();
        cleanText = await textClient.process(rawResult.text);
      } catch (pipeErr) {
        const trans = translateError(pipeErr);
        logger.warn(`Text pipeline failed: [${trans.kind}] ${trans.message}`);
        cleanText = rawResult.text;
      }

      if (cleanText && settingsStore.get('scriptMode') !== 'native') {
        cleanText = await transliterateToRoman(cleanText);
      }

      logger.logTranscript(cleanText);

      // Check intent if assistant is enabled
      const assistantEnabled = settingsStore.get('assistantEnabled') !== false;
      const intent = assistantEnabled ? detectIntent(cleanText, hasActiveMemoryContext()) : { mode: 'dictate', query: cleanText };
      logger.info(`Detected intent: [${intent.mode}] query: "${intent.query}"`);

      // search screenshots
      if (intent.mode === 'find') {
        try {
          const results = await findScreenshots(intent.query);
          return {
            success: true,
            mode: 'find',
            query: intent.query,
            results,
            text: results.length ? `Found ${results.length} screenshot(s) for "${intent.query}"` : `No screenshots matched "${intent.query}"`,
            rawText: rawResult.text,
            pasted: false,
          };
        } catch (findErr) {
          return {
            success: false,
            mode: 'find',
            query: intent.query,
            error: findErr.message,
            pasted: false,
          };
        }
      }

      // save current screen
      if (intent.mode === 'remember') {
        try {
          const remembered = await rememberCurrentScreen(intent.query);
          return {
            success: true,
            mode: 'remember',
            query: intent.query,
            text: 'Screen saved to memory',
            path: remembered.path,
            rawText: rawResult.text,
            pasted: false,
          };
        } catch (remErr) {
          return {
            success: false,
            mode: 'remember',
            query: intent.query,
            error: remErr.message,
            pasted: false,
          };
        }
      }

      // ask questions about a saved screen
      if (intent.mode === 'query_memory') {
        try {
          const answer = await askAboutRememberedScreen(intent.query);
          let pasteResult = { success: true, pasted: true };
          if (answer) {
            pasteResult = await pasteTextToActiveWindow(answer);
          }
          return {
            success: true,
            mode: 'query_memory',
            query: intent.query,
            text: answer,
            rawText: rawResult.text,
            pasted: pasteResult.pasted,
            warning: pasteResult.reason === 'ELEVATED_WINDOW' ? pasteResult.message : null,
          };
        } catch (memErr) {
          logger.error(`Memory query failed: ${memErr.message}`);
          return {
            success: false,
            mode: 'query_memory',
            query: intent.query,
            error: memErr.message,
            pasted: false,
          };
        }
      }

      // summarize recent screenshots
      if (intent.mode === 'summarize') {
        try {
          const summary = await summarizeRecent(intent.query);
          let pasteResult = { success: true, pasted: true };
          if (summary) {
            pasteResult = await pasteTextToActiveWindow(summary);
          }
          return {
            success: true,
            mode: 'summarize',
            query: intent.query,
            text: summary,
            rawText: rawResult.text,
            pasted: pasteResult.pasted,
            warning: pasteResult.reason === 'ELEVATED_WINDOW' ? pasteResult.message : null,
          };
        } catch (sumErr) {
          return {
            success: false,
            mode: 'summarize',
            query: intent.query,
            error: sumErr.message,
            pasted: false,
          };
        }
      }

      // ask about current screen
      if (intent.mode === 'ask') {
        try {
          const reply = await askAboutScreen(intent.query);
          let pasteResult = { success: true, pasted: true };
          if (reply) {
            pasteResult = await pasteTextToActiveWindow(reply);
          }
          return {
            success: true,
            mode: 'ask',
            query: intent.query,
            text: reply,
            rawText: rawResult.text,
            pasted: pasteResult.pasted,
            warning: pasteResult.reason === 'ELEVATED_WINDOW' ? pasteResult.message : null,
          };
        } catch (askErr) {
          return {
            success: false,
            mode: 'ask',
            query: intent.query,
            error: askErr.message,
            pasted: false,
          };
        }
      }

      // standard dictation
      let pasteResult = { success: true, pasted: true };
      if (cleanText) {
        pasteResult = await pasteTextToActiveWindow(cleanText);
      }

      return {
        success: true,
        mode: 'dictate',
        text: cleanText,
        rawText: rawResult.text,
        duration: rawResult.duration,
        words: rawResult.words,
        pasted: pasteResult.pasted,
        warning: pasteResult.reason === 'ELEVATED_WINDOW' ? pasteResult.message : null,
      };
    } catch (err) {
      const trans = translateError(err);
      logger.error(`Transcription pipeline unexpected error: [${trans.kind}] ${trans.message}`);
      return {
        success: false,
        error: trans.message,
        kind: trans.kind,
      };
    }
  });

  // Manual paste request
  ipcMain.on('pill:paste', async (_event, text) => {
    await pasteTextToActiveWindow(text);
  });

  // Open Windows microphone privacy settings
  ipcMain.on('pill:open-mic-settings', () => {
    shell.openExternal('ms-settings:privacy-microphone').catch(() => {});
  });

  // Window visibility & size
  ipcMain.on('pill:hide', () => {
    const win = getPillWindow();
    if (win) win.hide();
  });

  ipcMain.on('pill:set-height', (_event, height) => {
    const win = getPillWindow();
    if (win && !win.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { height: screenH } = primaryDisplay.workAreaSize;
      const targetH = Math.max(68, Math.min(height || 68, 420));
      const targetY = screenH - targetH - 25;
      const bounds = win.getBounds();
      win.setBounds({
        x: bounds.x,
        y: targetY,
        width: bounds.width,
        height: targetH,
      });
    }
  });

  // Open settings
  ipcMain.on('pill:open-settings', () => {
    if (openSettingsWindow) openSettingsWindow();
  });

  // Speech engines list & switch
  ipcMain.handle('speech:list-engines', async () => {
    try {
      const client = getSpeechClient();
      return await client.listEngines();
    } catch (err) {
      logger.error(`Failed to list speech engines: ${err.message}`);
      return [];
    }
  });

  ipcMain.handle('speech:set-engine', async (_event, engineId) => {
    try {
      logger.info(`Live switching speech engine to: ${engineId}...`);
      const client = getSpeechClient();
      const res = await client.setEngine(engineId);
      settingsStore.set('engine', engineId);

      const pill = getPillWindow();
      if (pill) {
        pill.webContents.send('engine:changed', engineId);
      }

      return { success: true, active: engineId, ...res };
    } catch (err) {
      logger.error(`Live engine switch failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Settings get/set
  ipcMain.handle('settings:get-all', () => {
    return settingsStore.getAll();
  });

  ipcMain.handle('settings:save', async (_event, newSettings) => {
    const oldEngine = settingsStore.get('engine');

    for (const [k, v] of Object.entries(newSettings)) {
      settingsStore.set(k, v);
    }

    if (newSettings.groqApiKey !== undefined) {
      process.env.GROQ_API_KEY = newSettings.groqApiKey;
    }
    if (newSettings.gnaniApiKey !== undefined) {
      process.env.GNANI_API_KEY = newSettings.gnaniApiKey;
    }
    if (newSettings.speechLanguage !== undefined) {
      process.env.SPEECH_LANGUAGE = newSettings.speechLanguage;
    }
    if (newSettings.geminiApiKey !== undefined) {
      process.env.GEMINI_API_KEY = newSettings.geminiApiKey;
    }

    // Refresh screenshot watcher if memory settings or key changed
    try {
      startScreenshotWatcher();
    } catch (_) {}

    // If active engine changed, trigger live swap!
    if (newSettings.engine && newSettings.engine !== oldEngine) {
      try {
        logger.info(`Settings updated engine from ${oldEngine} to ${newSettings.engine}. Triggering live switch...`);
        const client = getSpeechClient();
        await client.setEngine(newSettings.engine);

        const pill = getPillWindow();
        if (pill) {
          pill.webContents.send('engine:changed', newSettings.engine);
        }
      } catch (err) {
        logger.error(`Engine live swap warning on save: ${err.message}`);
      }
    }

    return settingsStore.getAll();
  });

  // Assistant & Screenshot Memory handlers
  ipcMain.handle('assistant:status', () => {
    return getMemoryStatus();
  });

  ipcMain.handle('assistant:clear-memory', () => {
    clearMemoryStore();
    return { success: true };
  });

  ipcMain.handle('assistant:find', async (_event, query) => {
    return await findScreenshots(query);
  });

  ipcMain.on('assistant:copy-path', (_event, filePath) => {
    if (filePath) clipboard.writeText(filePath);
  });

  ipcMain.on('assistant:copy-image', (_event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) clipboard.writeImage(img);
    }
  });

  ipcMain.on('assistant:show-in-folder', (_event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
  });

  ipcMain.handle('assistant:choose-folder', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Screenshots Folder',
    });
    if (!res.canceled && res.filePaths?.[0]) {
      return res.filePaths[0];
    }
    return null;
  });

  // MCP Info and Allowed Directory Explorer integration
  ipcMain.handle('mcp:get-info', () => {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const allowedDir = process.env.MCP_ALLOWED_DIR || path.join(userProfile, 'LocalPillRecordings');
    return {
      allowedDir,
      speechEndpoint: 'http://localhost:8085/mcp',
      textEndpoint: 'http://localhost:8095/mcp',
    };
  });

  ipcMain.handle('mcp:open-allowed-dir', async () => {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const allowedDir = process.env.MCP_ALLOWED_DIR || path.join(userProfile, 'LocalPillRecordings');
    if (!fs.existsSync(allowedDir)) {
      try {
        fs.mkdirSync(allowedDir, { recursive: true });
      } catch (_) {}
    }
    await shell.openPath(allowedDir);
    return true;
  });
}
