import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Load .env file if present
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch (_) {}
  }
}
loadEnv();

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const SETTINGS_DIR = path.join(appData, 'LocalPill');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

function hasScreenshots(folder) {
  try {
    if (!folder || !fs.existsSync(folder)) return false;
    return fs.readdirSync(folder).some((f) => /\.(png|jpe?g|webp)$/i.test(f));
  } catch (_) {
    return false;
  }
}

function getDefaultScreenshotFolder() {
  const candidates = [
    process.env.ONEDRIVE ? path.join(process.env.ONEDRIVE, 'Pictures', 'Screenshots') : null,
    process.env.OneDriveConsumer ? path.join(process.env.OneDriveConsumer, 'Pictures', 'Screenshots') : null,
    path.join(os.homedir(), 'OneDrive', 'Pictures', 'Screenshots'),
    path.join(os.homedir(), 'Pictures', 'Screenshots'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (hasScreenshots(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(os.homedir(), 'Pictures', 'Screenshots');
}

const DEFAULT_SETTINGS = {
  hotkey: 'CommandOrControl+Shift+Space',
  engine: 'whisper-base',
  speechLanguage: process.env.SPEECH_LANGUAGE || 'en',
  scriptMode: 'romanized',
  transport: 'graft',
  groqApiKey: process.env.GROQ_API_KEY || '',
  gnaniApiKey: process.env.GNANI_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-3-flash-preview',
  assistantEnabled: true,
  memoryEnabled: true,
  memoryMode: 'hybrid',
  memoryMaxEntries: 25,
  memoryMaxLookbackHours: 24,
  screenshotFolder: getDefaultScreenshotFolder(),
  logTranscripts: false,
  textPipeline: {
    fillerRemoval: true,
    spokenPunctuation: true,
    casing: true
  },
  snippets: {
    ':email': 'my.email@example.com',
    'my email': 'my.email@example.com',
    ':shrug': '¯\\_(ツ)_/¯'
  }
};

class SettingsStore {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      }
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          transport: 'graft',
          textPipeline: {
            ...DEFAULT_SETTINGS.textPipeline,
            ...(parsed.textPipeline || {})
          },
          snippets: {
            ...DEFAULT_SETTINGS.snippets,
            ...(parsed.snippets || {})
          }
        };
        // Masking was removed; drop leftover keys from older settings files
        for (const key of Object.keys(this.settings.textPipeline)) {
          if (key.startsWith('mask')) delete this.settings.textPipeline[key];
        }
        // Upgrade any deprecated Gemini models
        if (!this.settings.geminiModel || this.settings.geminiModel.includes('2.5') || this.settings.geminiModel.includes('2.0') || this.settings.geminiModel.includes('1.5')) {
          this.settings.geminiModel = 'gemini-3-flash-preview';
        }
        // If current screenshot folder doesn't have screenshots, auto-switch to active folder
        if (!hasScreenshots(this.settings.screenshotFolder)) {
          const autoFolder = getDefaultScreenshotFolder();
          if (hasScreenshots(autoFolder)) {
            this.settings.screenshotFolder = autoFolder;
          }
        }
        if (!this.settings.memoryMaxEntries || this.settings.memoryMaxEntries > 25) {
          this.settings.memoryMaxEntries = 25;
        }
        if (!this.settings.memoryMaxLookbackHours) {
          this.settings.memoryMaxLookbackHours = 24;
        }
        if (!this.settings.memoryMode) {
          this.settings.memoryMode = 'hybrid';
        }
        // Fallback to environment variables if not configured in settings.json
        if (!this.settings.geminiApiKey && process.env.GEMINI_API_KEY) {
          this.settings.geminiApiKey = process.env.GEMINI_API_KEY;
        }
        if (!this.settings.groqApiKey && process.env.GROQ_API_KEY) {
          this.settings.groqApiKey = process.env.GROQ_API_KEY;
        }
        // Persist corrected transport to disk
        this.save();
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[Settings] Error loading settings:', err.message);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  save() {
    try {
      if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Settings] Error saving settings:', err.message);
    }
  }

  get(key) {
    return this.settings[key];
  }

  set(key, value) {
    this.settings[key] = value;
    this.save();
  }

  getAll() {
    return { ...this.settings };
  }

  getSettingsPath() {
    return SETTINGS_FILE;
  }
}

export const settingsStore = new SettingsStore();
