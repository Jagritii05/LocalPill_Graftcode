import { configureGraftcode } from './adapter.js';
import { logger } from '../logger.js';

export class GraftSpeechClient {
  constructor() {
    this._initialized = false;
    this._speechService = null;
  }

  async _ensureInit() {
    if (!this._initialized) {
      await configureGraftcode();
      const { SpeechService } = await import('@graft/pypi-speech-gateway');
      this._speechService = SpeechService;
      this._initialized = true;
    }
  }

  async isReady() {
    try {
      await this._ensureInit();
      const rawJson = await this._speechService.healthJson();
      const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      return {
        ready: Boolean(parsed.ready),
        error: parsed.error || null,
        engine: parsed.engine || 'whisper-base',
      };
    } catch (err) {
      return {
        ready: false,
        error: `Graftcode Gateway A connection failed: ${err.message}`,
        engine: 'unknown',
      };
    }
  }

  async transcribe(audioBuffer, options = {}) {
    await this._ensureInit();
    const base64Audio = Buffer.isBuffer(audioBuffer)
      ? audioBuffer.toString('base64')
      : Buffer.from(audioBuffer).toString('base64');

    const language = typeof options === 'string' ? '' : (options.language || '');
    const prompt = typeof options === 'string' ? options : (options.prompt || '');
    const wirePrompt = language
      ? JSON.stringify({ __localpill_opts: true, language, prompt })
      : prompt;

    logger.info(`Sending ${base64Audio.length} chars of base64 audio over Graftcode RPC...`);
    const rawJson = await this._speechService.transcribeBytesJson(base64Audio, wirePrompt);
    const result = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

    if (result.error && !result.text) {
      throw new Error(`Graftcode transcription error: ${result.error}`);
    }

    return {
      text: result.text || '',
      language: result.language || 'en',
      duration: result.duration || 0,
      words: result.words || [],
    };
  }

  async listEngines() {
    try {
      await this._ensureInit();
      const rawJson = await this._speechService.listEnginesJson();
      const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.engines)) return parsed.engines;
      return [];
    } catch (err) {
      logger.error(`Graftcode listEngines failed: ${err.message}`);
      return [];
    }
  }

  async transcribeFile(filePath, prompt = '') {
    await this._ensureInit();
    const rawJson = await this._speechService.transcribeFileJson(filePath, prompt || '');
    const result = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

    if (result.error && !result.text) {
      throw new Error(`Graftcode transcription error: ${result.error}`);
    }

    return {
      text: result.text || '',
      language: result.language || 'en',
      duration: result.duration || 0,
      words: result.words || [],
    };
  }

  async setEngine(engineId) {
    await this._ensureInit();
    const success = await this._speechService.switchEngine(engineId);
    return { success, active: engineId };
  }
}
