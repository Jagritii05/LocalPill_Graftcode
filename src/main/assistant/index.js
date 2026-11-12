import path from 'path';
import fs from 'fs';
import { memoryStore, MEMORY_DIR } from './memory-store.js';
import { generate, embed } from './gemini.js';
import { captureActiveScreen } from './screen-capture.js';
import { ensureRecentScreenshotsIndexed } from './screenshot-watcher.js';
import { settingsStore } from '../settings-store.js';
import { getLanguageConfig, isIndicLanguage } from './languages.js';

export { detectIntent } from './intent.js';
export { startScreenshotWatcher, stopScreenshotWatcher, getMemoryStatus, ensureRecentScreenshotsIndexed } from './screenshot-watcher.js';

const MIN_SCORE = 0.30;
const CAPTURES_DIR = path.join(MEMORY_DIR, 'captures');

// "remember this ..." - save current screen snapshot to persistent memory
export async function rememberCurrentScreen(note = '') {
  const shot = await captureActiveScreen();
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });

  const filename = `remember_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
  const filePath = path.join(CAPTURES_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(shot.base64, 'base64'));

  const prompt =
    'Describe this screen snapshot so it can be retrieved later from memory. ' +
    (note ? `User note: "${note}". ` : '') +
    'Include active applications, key topics, visible headings, errors, or documents. Plain text, 3 to 5 sentences, no markdown.';

  const description = await generate(prompt, [shot]);
  const embedding = await embed(description);

  memoryStore.add({
    filePath,
    description,
    embedding,
    createdAt: Date.now(),
    intentional: true,
  });

  return {
    path: filePath,
    name: filename,
    description,
  };
}

// Clear all indexed memory items
export function clearMemoryStore() {
  memoryStore.clear();
  return true;
}

// "find ..." - search screenshot memory
export async function findScreenshots(query, limit = 5) {
  if (!query) throw new Error('Say what to find, e.g. "find the screenshot with the error".');

  // Ensure recent screenshots from watched folders are indexed
  await ensureRecentScreenshotsIndexed(5).catch(() => {});

  if (memoryStore.count() === 0) {
    throw new Error('No screenshots found in your Screenshots folder. Take a screenshot with Win+Shift+S or PrtScn.');
  }
  const qEmb = await embed(query);
  const allResults = memoryStore.search(qEmb, limit);
  const filtered = allResults.filter((r) => r.score >= MIN_SCORE);
  const results = filtered.length > 0 ? filtered : allResults.slice(0, 2);

  return results.map((r) => ({
    path: r.path,
    name: path.basename(r.path),
    description: r.description,
    score: Math.round(r.score * 100) / 100,
    createdAt: r.createdAt,
  }));
}

// "summarize ..." - summary of the latest screenshots
export async function summarizeRecent(focus = '', limit = 10) {
  // Always ensure newest screenshots are indexed before summarizing
  await ensureRecentScreenshotsIndexed(5).catch(() => {});
  const recent = memoryStore.recent(limit);
  if (!recent.length) {
    throw new Error('No screenshots indexed yet to summarize.');
  }
  const list = recent
    .map((e, i) => `${i + 1}. [${new Date(e.createdAt).toLocaleString()}] ${e.description}`)
    .join('\n');

  const speechLang = settingsStore.get('speechLanguage') || 'en';
  const langConf = getLanguageConfig(speechLang);
  const langLine = isIndicLanguage(speechLang) ? ` ${langConf.styleGuide}` : '';

  const prompt =
    `These are descriptions of my ${recent.length} most recent screenshots, newest first:\n\n${list}\n\n` +
    (focus ? `Focus on: ${focus}\n\n` : '') +
    `Summarize what I was working on in a few short sentences. Plain text, no markdown.${langLine}`;

  return generate(prompt);
}

// "hey pill / reply / answer ..." - look at the screen and write a reply to paste
export async function askAboutScreen(instruction) {
  const shot = await captureActiveScreen();
  const speechLang = settingsStore.get('speechLanguage') || 'en';
  const langConf = getLanguageConfig(speechLang);
  const langHint = isIndicLanguage(speechLang)
    ? ` If the instruction is an explanation request or asked in ${langConf.name}, ${langConf.styleGuide} For formal email or chat replies, default to clean polite English unless the user explicitly asks to reply in ${langConf.name}.`
    : '';

  const prompt = instruction
    ? `Instruction: ${instruction}`
    : 'Write a suitable reply to what is shown on screen.';

  return generate(prompt, [shot], {
    system:
      'You are a writing assistant. The user is looking at the attached screenshot of their screen. ' +
      'Follow their instruction using what is on screen as context. ' +
      'Return only the text to paste at their cursor: no preamble, no quotes, no markdown.' +
      langHint,
  });
}

// check if there is a recent screen context in memory
export function hasActiveMemoryContext() {
  const ctx = memoryStore.getActiveContext();
  if (!ctx || !ctx.filePath) return false;
  const isRecent = ctx.timestamp && (Date.now() - ctx.timestamp < 15 * 60 * 1000);
  return Boolean(isRecent && fs.existsSync(ctx.filePath));
}

// answer questions about a previously remembered screen
export async function askAboutRememberedScreen(question) {
  if (!question || !question.trim()) {
    throw new Error('Please ask a question about the remembered screen.');
  }

  let targetPath = null;
  let targetDesc = '';
  const activeCtx = memoryStore.getActiveContext();

  // try vector search if the question targets a specific topic
  const isFollowUp = question.match(/^(?:now\s+)?(?:explain|what\s+about|step|it|that)\b/i);
  if (memoryStore.count() > 1 && !isFollowUp) {
    try {
      const qEmb = await embed(question);
      const searchHits = memoryStore.search(qEmb, 2);
      if (searchHits.length > 0 && searchHits[0].score > 0.65 && fs.existsSync(searchHits[0].path)) {
        targetPath = searchHits[0].path;
        targetDesc = searchHits[0].description;
      }
    } catch (_) {}
  }

  // fallback to active context or the newest saved screen
  if (!targetPath) {
    if (activeCtx && activeCtx.filePath && fs.existsSync(activeCtx.filePath)) {
      targetPath = activeCtx.filePath;
      targetDesc = activeCtx.description;
    } else {
      const latest = memoryStore.getLatestRemembered();
      if (latest && fs.existsSync(latest.path)) {
        targetPath = latest.path;
        targetDesc = latest.description;
      }
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error('No remembered screens found in memory. Say "remember this screen" first.');
  }

  memoryStore.setActiveContext(targetPath, targetDesc);

  const ext = path.extname(targetPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const base64 = fs.readFileSync(targetPath).toString('base64');
  const imagePart = { mimeType, base64 };

  const history = memoryStore.activeContext.history || [];
  let historySection = '';
  if (history.length > 0) {
    historySection = 'Prior conversation turns on this screen:\n' +
      history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n') + '\n\n';
  }

  const speechLang = settingsStore.get('speechLanguage') || 'en';
  const langConf = getLanguageConfig(speechLang);
  const langRule = isIndicLanguage(speechLang)
    ? `\n- ${langConf.styleGuide}`
    : '';

  const prompt =
    historySection +
    `The user is working in an active application (e.g. email, chat, or editor) and asks a specific question about this previously remembered screen:\n` +
    `User Question: "${question}"\n\n` +
    `Instructions:\n` +
    `- Answer the question directly, accurately, and concisely based strictly on what is visible on this screen.\n` +
    `- Return only the clean text to paste at their cursor (e.g. steps, code, numbers, explanation).\n` +
    `- Do NOT include conversational filler (e.g. "Sure! Here is...", "Based on the image..."), markdown code blocks, or quote marks unless specifically asked.${langRule}`;

  const answer = await generate(prompt, [imagePart], {
    system:
      'You are an intelligent visual memory assistant. The user previously saved a screen to memory and is now asking you to recall and explain specific details from that screen to paste into their current application. Provide precise, direct, and factual answers based strictly on the attached image.',
  });

  memoryStore.addContextTurn(question, answer);
  return answer;
}
