/**
 * Text normalization: filler words, spoken punctuation, sentence casing, and snippets.
 */

// Spoken punctuation and symbols mappings
const SPOKEN_PUNCTUATION_PATTERNS = [
  { regex: /\b(exclamation mark|exclamation point)\b/gi, replacement: '!' },
  { regex: /\b(question mark|prashna chinh)\b/gi, replacement: '?' },
  { regex: /\b(new line|newline|line change)\b/gi, replacement: '\n' },
  { regex: /\b(full stop|period|purna viram)\b/gi, replacement: '.' },
  { regex: /\b(comma|alpaviram)\b/gi, replacement: ',' },
  { regex: /\b(colon)\b/gi, replacement: ':' },
  { regex: /\b(semicolon)\b/gi, replacement: ';' },
  { regex: /\b(open quote)\b/gi, replacement: '"' },
  { regex: /\b(close quote)\b/gi, replacement: '"' },
  { regex: /\b(at the rate|add the rate)\b/gi, replacement: '@' },
  { regex: /\b(hashtag|hash tag)\b/gi, replacement: '#' },
  { regex: /\b(slash|forward slash)\b/gi, replacement: '/' },
  { regex: /\b(backslash)\b/gi, replacement: '\\' },
  { regex: /\b(underscore)\b/gi, replacement: '_' },
  { regex: /\b(hyphen|dash)\b/gi, replacement: '-' },
];

const SPOKEN_DIGIT_MAP = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/**
 * Converts sequences of 4 or more consecutive spoken digit words (e.g. "four two four two")
 * into digit strings (e.g. "4242"), enabling downstream Luhn, Aadhaar, and phone regex detection.
 * @param {string} text
 * @returns {string}
 */
export function normalizeSpokenDigits(text) {
  if (!text || typeof text !== 'string') return '';
  const seqRegex = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)){3,}\b/gi;
  return text.replace(seqRegex, (match) => {
    return match
      .toLowerCase()
      .split(/\s+/)
      .map((w) => SPOKEN_DIGIT_MAP[w] || w)
      .join('');
  });
}

/**
 * Removes filler words (um, uh, er, ah, like, you know) with word boundary checks.
 * Handles adjacent filler words and cleans up excess spacing.
 * @param {string} text
 * @returns {string}
 */
export function removeFillerWords(text) {
  if (!text || typeof text !== 'string') return '';

  let prev = '';
  let cur = text;

  // Run in a loop until no more adjacent filler words remain
  // Filler words: um, uh, er, ah, you know, like
  const fillerRegex = /\b(um|uh|er|ah|you know|like)\b/gi;

  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(fillerRegex, '');
    cur = cur.replace(/[ \t]{2,}/g, ' ');
  }

  // Clean whitespace around newlines and trim
  return cur
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Converts spoken punctuation words to punctuation characters and fixes surrounding spacing.
 * @param {string} text
 * @returns {string}
 */
export function replaceSpokenPunctuation(text) {
  if (!text || typeof text !== 'string') return '';
  let result = text;

  for (const { regex, replacement } of SPOKEN_PUNCTUATION_PATTERNS) {
    result = result.replace(regex, replacement);
  }

  // Remove spaces immediately before punctuation marks (. , ? ! ; and : if not a snippet trigger)
  result = result.replace(/[ \t]+([.,?!;]|:(?![a-zA-Z_]))/g, '$1');

  // Ensure single space after sentence punctuation (. , ? ! ;) when immediately followed by non-space
  result = result.replace(/([.,?!;])(?=[^\s"'\n\r])/g, '$1 ');

  // For colons, only ensure space if NOT a timestamp (e.g. 10:30) or snippet trigger (e.g. :email)
  result = result.replace(/(?<!\d):(?!\d|[a-zA-Z_])/g, ': ');

  return result.trim();
}

/**
 * Applies sentence casing:
 * - Capitalizes first letter of text.
 * - Capitalizes first letter after terminal punctuation (. ? !) or newlines.
 * @param {string} text
 * @returns {string}
 */
export function applySentenceCasing(text) {
  if (!text || typeof text !== 'string') return '';

  // Capitalize very first alphanumeric character
  let result = text.replace(/^(\s*)([a-z])/i, (_m, ws, char) => ws + char.toUpperCase());

  // Capitalize first letter after terminal punctuation followed by whitespace/newlines
  result = result.replace(/([.?!]\s+)([a-z])/g, (_m, punctWs, char) => punctWs + char.toUpperCase());

  // Capitalize first letter on a new line
  result = result.replace(/(\n\s*)([a-z])/g, (_m, nlWs, char) => nlWs + char.toUpperCase());

  return result;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

/**
 * Expands custom voice snippets.
 * Longest triggers match first to prevent prefix collision.
 * Handles spoken colon variants ("colon email", "colin, email", ": email") as well as plain triggers.
 * @param {string} text
 * @param {Record<string, string>} snippets
 * @returns {string}
 */
export function expandSnippets(text, snippets = {}) {
  if (!text || typeof text !== 'string' || !snippets || Object.keys(snippets).length === 0) {
    return text;
  }

  let result = text;
  // Sort triggers by length descending
  const sortedTriggers = Object.keys(snippets).sort((a, b) => b.length - a.length);

  for (const trigger of sortedTriggers) {
    const expansion = snippets[trigger];
    if (!trigger || !expansion) continue;

    // 1. Exact match
    if (result.includes(trigger)) {
      result = result.split(trigger).join(expansion);
    }

    // 2. Colon-prefixed triggers (e.g. ':email')
    if (trigger.startsWith(':')) {
      const name = trigger.slice(1).trim();
      if (name) {
        const escaped = escapeRegExp(name);
        const patterns = [
          { pat: new RegExp('(?:\\s*:|:)\\s*' + escaped + '\\b', 'gi'), repl: ' ' + expansion },
          { pat: new RegExp('\\bcolon\\s*,?\\s*' + escaped + '\\b', 'gi'), repl: expansion },
          { pat: new RegExp('\\bcolin\\s*,?\\s*' + escaped + '\\b', 'gi'), repl: expansion },
          { pat: new RegExp('\\bcall\\s+in\\s*,?\\s*' + escaped + '\\b', 'gi'), repl: expansion },
        ];
        for (const { pat, repl } of patterns) {
          result = result.replace(pat, repl);
        }
      }
    } else {
      // 3. Plain word / phrase trigger (e.g. 'my email' or 'email')
      const escaped = escapeRegExp(trigger);
      const wordPat = new RegExp('\\b' + escaped + '\\b', 'gi');
      result = result.replace(wordPat, expansion);
    }
  }

  return result.replace(/[ \t]{2,}/g, ' ');
}
