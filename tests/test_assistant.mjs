import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectIntent } from '../src/main/assistant/intent.js';
import { MemoryStore, cosine } from '../src/main/assistant/memory-store.js';

console.log('[Test] Running Assistant & Memory Store Unit Tests...');

// 1. intent detection
const findTest1 = detectIntent('find the invoice from amazon');
assert.strictEqual(findTest1.mode, 'find');
assert.strictEqual(findTest1.query, 'the invoice from amazon');

const findTest2 = detectIntent('search for flight confirmation tickets.');
assert.strictEqual(findTest2.mode, 'find');
assert.strictEqual(findTest2.query, 'flight confirmation tickets');

const findTest3 = detectIntent('hey pill where is my python script screenshot?');
assert.strictEqual(findTest3.mode, 'find');
assert.strictEqual(findTest3.query, 'my python script screenshot');

const remTest1 = detectIntent('hey pill remember this');
assert.strictEqual(remTest1.mode, 'remember');

const remTest2 = detectIntent('remember this screen');
assert.strictEqual(remTest2.mode, 'remember');

const remTestHappy = detectIntent('Happy, remember this screen.');
assert.strictEqual(remTestHappy.mode, 'remember');

const remTestPlease = detectIntent('Please remember this screen');
assert.strictEqual(remTestPlease.mode, 'remember');

const remTestMe = detectIntent('remember me');
assert.strictEqual(remTestMe.mode, 'remember');
assert.strictEqual(remTestMe.query, '');

const remTest3 = detectIntent('save to memory: project architecture');
assert.strictEqual(remTest3.mode, 'remember');
assert.strictEqual(remTest3.query, 'project architecture');

const sumTest1 = detectIntent('summarize my day');
assert.strictEqual(sumTest1.mode, 'summarize');

const sumTest2 = detectIntent('hey pill what was i working on?');
assert.strictEqual(sumTest2.mode, 'summarize');

const askTest1 = detectIntent('ask what is the error message on screen');
assert.strictEqual(askTest1.mode, 'ask');
assert.strictEqual(askTest1.query, 'what is the error message on screen');

const askTest2 = detectIntent('hey pill reply to this email saying I will join later');
assert.strictEqual(askTest2.mode, 'ask');
assert.strictEqual(askTest2.query, 'email saying I will join later');

const askTest3 = detectIntent('hey pill what does this error mean?');
assert.strictEqual(askTest3.mode, 'ask');
assert.strictEqual(askTest3.query, 'what does this error mean');

// memory queries
const memQ1 = detectIntent('Explain the steps of the program that I asked you to remember');
assert.strictEqual(memQ1.mode, 'query_memory');
assert.ok(memQ1.query.includes('Explain the steps of the program'));

const memQ2 = detectIntent('Summarize the screen that I asked you to remember, or viewer.');
assert.strictEqual(memQ2.mode, 'query_memory');

const memQ3 = detectIntent('What was the error on that screen?');
assert.strictEqual(memQ3.mode, 'query_memory');

const memQ4 = detectIntent('From memory, what is the API key?');
assert.strictEqual(memQ4.mode, 'query_memory');

const memQFollowUp = detectIntent('Now explain step 2 in detail', true);
assert.strictEqual(memQFollowUp.mode, 'query_memory');

const dictateTest1 = detectIntent('The quick brown fox jumps over the lazy dog.');
assert.strictEqual(dictateTest1.mode, 'dictate');

const dictateTest2 = detectIntent('Meeting notes: discuss roadmap and budget.');
assert.strictEqual(dictateTest2.mode, 'dictate');

// multilingual intent checks
const indicDictate = detectIntent('Mera naam Rahul hai');
assert.strictEqual(indicDictate.mode, 'dictate');

const indicAsk = detectIntent('Is screen ko explain karo');
assert.strictEqual(indicAsk.mode, 'ask');

const indicReply = detectIntent('Is mail ka reply likh do ki main kal aunga');
assert.strictEqual(indicReply.mode, 'ask');
assert.ok(indicReply.query.includes('main kal aunga'));

const indicRemember = detectIntent('Is screen ko yaad rakhna');
assert.strictEqual(indicRemember.mode, 'remember');

const indicMemQ = detectIntent('Jo screen yaad rakhne ko bola tha usme kya error hai?');
assert.strictEqual(indicMemQ.mode, 'query_memory');

console.log('[PASS] Intent detection tests passed');

// 2. cosine similarity math
const v1 = [1, 0, 0];
const v2 = [1, 0, 0];
const v3 = [0, 1, 0];
const v4 = [-1, 0, 0];

assert.ok(Math.abs(cosine(v1, v2) - 1.0) < 0.0001, 'Identical vectors must equal 1.0');
assert.ok(Math.abs(cosine(v1, v3) - 0.0) < 0.0001, 'Orthogonal vectors must equal 0.0');
assert.ok(Math.abs(cosine(v1, v4) - (-1.0)) < 0.0001, 'Opposite vectors must equal -1.0');

console.log('[PASS] Cosine similarity math tests passed');

// 3. memorystore indexing and vector search
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-memory-'));
const testIndexFile = path.join(tempDir, 'index.json');

try {
  const store = new MemoryStore(testIndexFile);
  assert.strictEqual(store.count(), 0);

  // Create temporary mock screenshot files
  const fileA = path.join(tempDir, 'screenshot_invoice.png');
  const fileB = path.join(tempDir, 'screenshot_chat.png');
  fs.writeFileSync(fileA, 'fake-invoice-image-bytes');
  fs.writeFileSync(fileB, 'fake-chat-image-bytes');

  store.add({
    filePath: fileA,
    description: 'Amazon receipt for headphones invoice totaling $50',
    embedding: [0.9, 0.1, 0.0],
    createdAt: 1000,
  });

  store.add({
    filePath: fileB,
    description: 'Slack chat talking about project roadmap',
    embedding: [0.0, 0.9, 0.1],
    createdAt: 2000,
  });

  assert.strictEqual(store.count(), 2);
  assert.strictEqual(store.has(fileA), true);
  assert.strictEqual(store.has(fileB), true);

  // Search with query embedding similar to invoice
  const queryEmbedding = [0.85, 0.15, 0.0];
  const results = store.search(queryEmbedding, 2);

  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].path, path.resolve(fileA));
  assert.ok(results[0].score > 0.95, 'Top match should have high score');

  // Test pruning deleted files
  fs.unlinkSync(fileA);
  store.prune();
  assert.strictEqual(store.count(), 1);
  assert.strictEqual(store.has(fileA), false);
  assert.strictEqual(store.has(fileB), true);

  // Test re-loading from saved JSON file
  const reloadedStore = new MemoryStore(testIndexFile);
  assert.strictEqual(reloadedStore.count(), 1);

  // Test FIFO capacity capping (test with capacity of 3)
  const cappedStore = new MemoryStore(testIndexFile, 3);
  const fileC = path.join(tempDir, 'screenshot_c.png');
  const fileD = path.join(tempDir, 'screenshot_d.png');
  const fileE = path.join(tempDir, 'screenshot_e.png');
  fs.writeFileSync(fileC, 'c');
  fs.writeFileSync(fileD, 'd');
  fs.writeFileSync(fileE, 'e');

  cappedStore.add({ filePath: fileC, description: 'C', embedding: [1, 0, 0] });
  cappedStore.add({ filePath: fileD, description: 'D', embedding: [0, 1, 0] });
  // Currently cappedStore has fileB, fileC, fileD (3 total)
  assert.strictEqual(cappedStore.count(), 3);

  // Adding 4th item triggers FIFO eviction of oldest entry (fileB)
  cappedStore.add({ filePath: fileE, description: 'E', embedding: [0, 0, 1] });
  assert.strictEqual(cappedStore.count(), 3);
  assert.strictEqual(cappedStore.has(fileB), false);
  assert.strictEqual(cappedStore.has(fileE), true);

  // Test clear
  cappedStore.clear();
  assert.strictEqual(cappedStore.count(), 0);

  // Test active context tracking and conversational history
  cappedStore.add({ filePath: fileC, description: 'Test program', embedding: [1, 0, 0], intentional: true });
  const activeCtx = cappedStore.getActiveContext();
  assert.ok(activeCtx, 'Active context should be set for intentional capture');
  assert.strictEqual(activeCtx.filePath, path.resolve(fileC));

  cappedStore.addContextTurn('Explain step 1', 'Step 1 is initialization');
  assert.strictEqual(cappedStore.activeContext.history.length, 2);
  assert.strictEqual(cappedStore.activeContext.history[0].role, 'user');
  assert.strictEqual(cappedStore.activeContext.history[1].text, 'Step 1 is initialization');

  console.log('[PASS] MemoryStore indexing, active context, and vector search tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('[Test] ALL ASSISTANT UNIT TESTS PASSED!');
