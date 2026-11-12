import { settingsStore } from '../settings-store.js';
import { devanagariToRoman, hasIndicScript, applySentenceCasing } from '../../../services/text/index.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODELS = ['gemini-embedding-001', 'gemini-embedding-2-preview'];
const FALLBACK_GENERATE_MODELS = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-flash-latest'];

function getApiKey() {
  const key = settingsStore.get('geminiApiKey') || process.env.GEMINI_API_KEY || '';
  if (!key) {
    throw new Error('Gemini API key missing. Add it in Settings > Assistant.');
  }
  return key;
}

async function post(path, body, timeoutMs = 45000) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getApiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Gemini error: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Ask Gemini with text and optional images ({ mimeType, base64 })
export async function generate(prompt, images = [], { system } = {}) {
  const preferred = settingsStore.get('geminiModel');
  const candidateModels = [
    preferred && !preferred.includes('2.5') && !preferred.includes('2.0') && !preferred.includes('1.5')
      ? preferred
      : 'gemini-3-flash-preview',
    ...FALLBACK_GENERATE_MODELS,
  ];
  const models = [...new Set(candidateModels)];

  const parts = [{ text: prompt }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  }

  const body = { contents: [{ role: 'user', parts }] };
  if (system) {
    body.system_instruction = { parts: [{ text: system }] };
  }

  let lastErr = null;
  for (const model of models) {
    try {
      const data = await post(`models/${model}:generateContent`, body);
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
        .trim();

      if (text) return text;
    } catch (err) {
      lastErr = err;
      if (err.status === 404 || err.status === 400 || err.status === 503) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Gemini generation failed.');
}

// Turn text into a vector for similarity search
export async function embed(text) {
  let lastErr = null;
  for (const model of EMBED_MODELS) {
    try {
      const data = await post(`models/${model}:embedContent`, {
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }, 20000);
      const values = data?.embedding?.values;
      if (Array.isArray(values) && values.length) return values;
    } catch (err) {
      lastErr = err;
      // Try the next model only if this one isn't available
      if (err.status !== 404 && err.status !== 400) throw err;
    }
  }
  throw lastErr || new Error('Embedding failed.');
}

export function hasApiKey() {
  return Boolean(settingsStore.get('geminiApiKey') || process.env.GEMINI_API_KEY);
}

const TRANSLITERATION_SYSTEM_PROMPT =
  'You are a strict phonetic script transliterator. Convert Indic script text ' +
  '(Devanagari, Tamil, Bengali, Telugu, Kannada, Marathi, Gujarati, etc.) into Romanized English/Latin letters ' +
  '(Hinglish, Tanglish, Benglish) exactly as spoken.\n\n' +
  'CRITICAL RULES:\n' +
  '1. NEVER translate the meaning into English. Keep the exact same spoken words, only write them using English letters.\n' +
  '   - "मेरा नाम जागृति है।" -> "Mera naam Jagriti hai." (NEVER "My name is Jagriti.")\n' +
  '   - "कल सुबह १० बजे मीटिंग है।" -> "Kal subah 10 baje meeting hai." (NEVER "There is a meeting tomorrow at 10 am.")\n' +
  '   - "आज मौसम बहुत अच्छा है" -> "Aaj mausam bahut accha hai"\n' +
  '   - "நன்றி வணக்கம்" -> "Nandri vanakkam"\n' +
  '2. Preserve punctuation, numbers, and natural capitalization (including proper names).\n' +
  '3. Output ONLY the transliterated text. No quotes, no explanations.';

// Phonetic transliteration from Indic Unicode scripts to Latin script without translating meaning
export async function transliterateToRoman(rawText) {
  if (!rawText || !hasIndicScript(rawText)) {
    return rawText;
  }

  if (hasApiKey()) {
    try {
      const out = await generate(rawText, [], { system: TRANSLITERATION_SYSTEM_PROMPT });
      if (out) {
        return out.replace(/^["']|["']$/g, '').trim();
      }
    } catch (_) {}
  }

  const groqKey = settingsStore.get('groqApiKey') || process.env.GROQ_API_KEY || '';
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: TRANSLITERATION_SYSTEM_PROMPT },
            { role: 'user', content: rawText },
          ],
          temperature: 0.1,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        const out = (data?.choices?.[0]?.message?.content || '').trim();
        if (out) {
          return out.replace(/^["']|["']$/g, '').trim();
        }
      }
    } catch (_) {}
  }

  // Offline deterministic fallback for Devanagari text
  const fallback = devanagariToRoman(rawText);
  return fallback ? applySentenceCasing(fallback) : rawText;
}
