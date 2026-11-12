// Deterministic phonetic transliteration fallback for Indic scripts (Devanagari -> Latin/Hinglish)
// Used when offline or when no LLM key is available for transliteration.

const INDEPENDENT_VOWELS = {
  'अ': 'a',
  'आ': 'aa',
  'इ': 'i',
  'ई': 'ee',
  'उ': 'u',
  'ऊ': 'oo',
  'ऋ': 'ri',
  'ए': 'e',
  'ऐ': 'ai',
  'ओ': 'o',
  'औ': 'au',
  'ऑ': 'o',
};

const CONSONANTS = {
  'क': 'k',
  'ख': 'kh',
  'ग': 'g',
  'घ': 'gh',
  'ङ': 'ng',
  'च': 'ch',
  'छ': 'chh',
  'ज': 'j',
  'झ': 'jh',
  'ञ': 'ny',
  'ट': 't',
  'ठ': 'th',
  'ड': 'd',
  'ढ': 'dh',
  'ण': 'n',
  'त': 't',
  'थ': 'th',
  'द': 'd',
  'ध': 'dh',
  'न': 'n',
  'प': 'p',
  'फ': 'ph',
  'ब': 'b',
  'भ': 'bh',
  'म': 'm',
  'य': 'y',
  'र': 'r',
  'ल': 'l',
  'व': 'v',
  'श': 'sh',
  'ष': 'sh',
  'स': 's',
  'ह': 'h',
  // Nukta forms (already precomposed or formed with \u093C)
  'क़': 'q',
  'ख़': 'kh',
  'ग़': 'gh',
  'ज़': 'z',
  'ड़': 'd',
  'ढ़': 'dh',
  'फ़': 'f',
  'य़': 'y',
};

const NUKTA_MAP = {
  'क': 'q',
  'ख': 'kh',
  'ग': 'gh',
  'ज': 'z',
  'ड': 'd',
  'ढ': 'dh',
  'फ': 'f',
  'य': 'y',
};

const MATRAS = {
  'ा': 'aa',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॉ': 'o',
};

const HALANT = '्';
const NUKTA = '़';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';

const DEVANAGARI_DIGITS = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

export function hasIndicScript(text) {
  return Boolean(text && /[\u0900-\u0D7F]/.test(text));
}

function isDevanagariWordChar(ch) {
  return Boolean(ch && /[\u0900-\u097F]/.test(ch) && ch !== '।' && ch !== '॥');
}

function transliterateWord(word) {
  let out = '';
  const chars = Array.from(word);
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];

    if (DEVANAGARI_DIGITS[ch]) {
      out += DEVANAGARI_DIGITS[ch];
      i++;
      continue;
    }

    if (INDEPENDENT_VOWELS[ch]) {
      out += INDEPENDENT_VOWELS[ch];
      i++;
      continue;
    }

    if (CONSONANTS[ch]) {
      let base = CONSONANTS[ch];
      let nextIdx = i + 1;

      if (chars[nextIdx] === NUKTA) {
        base = NUKTA_MAP[ch] || base;
        nextIdx++;
      }

      const next = chars[nextIdx];
      if (next === HALANT) {
        out += base;
        i = nextIdx + 1;
        // Word-final conjunct tends to keep soft schwa if preceded by halant at very end
        continue;
      }

      if (MATRAS[next]) {
        const isWordEnd = nextIdx + 1 >= chars.length;
        // Use natural Hinglish short endings (mera, ladki) at word boundary
        let vowel = MATRAS[next];
        if (isWordEnd && next === 'ा') vowel = 'a';
        if (isWordEnd && next === 'ी') vowel = 'i';
        out += base + vowel;
        i = nextIdx + 1;
        continue;
      }

      // Inherent 'a' vowel (suppress at end of multi-char word unless single syllable like 'न')
      const isAtEnd = nextIdx >= chars.length;
      const isTrailingBeforeAnusvara =
        nextIdx + 1 === chars.length &&
        (chars[nextIdx] === ANUSVARA || chars[nextIdx] === CHANDRABINDU);

      if (isAtEnd && out.length > 0) {
        out += base;
      } else if (isTrailingBeforeAnusvara && out.length > 0) {
        out += base + 'a';
      } else {
        out += base + 'a';
      }
      i = nextIdx;
      continue;
    }

    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      // 'n' sounds most natural in Hinglish (main, hain, mein)
      out += 'n';
      i++;
      continue;
    }

    if (ch === VISARGA) {
      out += 'h';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function devanagariToRoman(text) {
  if (!text || typeof text !== 'string') return '';

  let normalized = text.replace(/॥|।/g, '.');
  let result = '';
  let token = '';

  for (const ch of normalized) {
    if (isDevanagariWordChar(ch)) {
      token += ch;
    } else {
      if (token) {
        result += transliterateWord(token);
        token = '';
      }
      result += ch;
    }
  }
  if (token) {
    result += transliterateWord(token);
  }

  return result
    .replace(/\s+([.,?!;])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

