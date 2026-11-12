import assert from 'assert';
import {
  TextPipeline,
  removeFillerWords,
  replaceSpokenPunctuation,
  applySentenceCasing,
  expandSnippets,
  devanagariToRoman,
  hasIndicScript,
} from '../services/text/index.js';

console.log('[Test] Running Text Pipeline Unit Tests...');

// 1. Normalization: Fillers
assert.strictEqual(
  removeFillerWords('um uh like I want to go er you know to the store ah'),
  'I want to go to the store',
  'Adjacent and scattered fillers should be cleanly removed'
);

// 2. Normalization: Spoken Punctuation
assert.strictEqual(
  replaceSpokenPunctuation('hello comma world period are you there question mark yes exclamation mark'),
  'hello, world. are you there? yes!',
  'Spoken punctuation words should be converted and spacing cleaned'
);

// 3. Normalization: Sentence Casing
assert.strictEqual(
  applySentenceCasing('hello world. this is great! how are you? good.'),
  'Hello world. This is great! How are you? Good.',
  'Sentence casing after ., !, ? should be applied'
);

// 4. Snippets Expansion
const snippets = {
  ':email': 'john@example.com',
  ':email_work': 'john.work@corp.com',
  ':shrug': '¯\\_(ツ)_/¯',
};

const snippetSample = 'Contact me at :email_work or personal :email :shrug';
assert.strictEqual(
  expandSnippets(snippetSample, snippets),
  'Contact me at john.work@corp.com or personal john@example.com ¯\\_(ツ)_/¯',
  'Overlapping snippet prefixes must expand correctly'
);

// Spoken colon variations expansion
assert.strictEqual(
  expandSnippets('Send this document to my colon email.', snippets),
  'Send this document to my john@example.com.',
  'Spoken colon email should expand snippet'
);

assert.strictEqual(
  expandSnippets('Send the document to Colin, email.', snippets),
  'Send the document to john@example.com.',
  'Whisper hearing Colin email should expand snippet'
);

assert.strictEqual(
  expandSnippets('Send this document to my email.', { 'my email': 'john@example.com' }),
  'Send this document to john@example.com.',
  'Plain text snippet trigger should expand'
);

// 5. End-to-End Pipeline Execution
const pipeline = new TextPipeline({ snippets });

// Deliverable requirement test: "um I need to buy milk period" -> "I need to buy milk."
const deliverableTest = pipeline.process('um I need to buy milk period');
assert.strictEqual(deliverableTest, 'I need to buy milk.', 'Master prompt deliverable case must pass exactly');

// Combined complex test: fillers, punctuation, casing, snippets
const complexTest = pipeline.process(
  'um uh hello comma send invoice to :email period thanks exclamation mark'
);
assert.strictEqual(
  complexTest,
  'Hello, send invoice to john@example.com. Thanks!',
  'Full end-to-end processing must be accurate'
);

// 6. Edge Cases
assert.strictEqual(pipeline.process(''), '', 'Empty string must return empty string');
assert.strictEqual(pipeline.process('   \n  \t  '), '', 'Whitespace only must return empty string');
assert.strictEqual(pipeline.process(null), '', 'Null must return empty string');
assert.strictEqual(pipeline.process(undefined), '', 'Undefined must return empty string');

const longText = 'word '.repeat(100) + 'period';
const processedLong = pipeline.process(longText);
assert.ok(processedLong.endsWith('.'), 'Long text processed properly');

// multilingual spoken punctuation
assert.strictEqual(
  replaceSpokenPunctuation('Mera naam Rahul hai purna viram Aap kaise ho prashna chinh'),
  'Mera naam Rahul hai. Aap kaise ho?',
  'Indic spoken punctuation should convert cleanly'
);

// deterministic Devanagari to Romanized Hinglish fallback
assert.strictEqual(hasIndicScript('मेरा नाम जागृति है।'), true);
assert.strictEqual(hasIndicScript('Mera naam Jagriti hai.'), false);
const romanizedFallback = applySentenceCasing(devanagariToRoman('मेरा नाम जागृति है।'));
assert.strictEqual(romanizedFallback, 'Mera naam jaagriti hai.');

console.log('[Test] ALL TEXT PIPELINE UNIT TESTS PASSED!');
