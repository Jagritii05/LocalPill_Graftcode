// Decide what the user wants from what they said.
// Dictation stays the default so normal typing never goes to the cloud.

// catch wake word variants and common mis-hearings
const PREFIX_RE = /^(?:(?:hey|hay|hi|ok|okay)\s+(?:pill|bill|phil|peel|bolo)|(?:hey|hay|hi|ok|okay)?\s*pill|happy|heavy|april|please|can\s+you|could\s+you)[,\s:-]*/i;

const FIND_RE = /^(?:find|search(?:\s+for)?|look\s+for|show\s+me|where(?:'s|\s+is)|dhundo|khojo)\b[\s,:-]*(.*)$/i;
const REMEMBER_RE = /^(?:remember(?:\s+(?:this|the|my|me))?(?:\s+screen)?|save(?:\s+(?:this|the|my))?(?:\s+screen)?\s+to\s+memory|(?:is|ye)\s+screen\s+(?:ko\s+)?yaad\s+rakh(?:o|na)|yaad\s+rakh(?:o|na)\s*(?:is\s+screen\s+ko)?|स्क्रीन\s+याद\s+रख(?:ो|ना))\b[\s,:-]*(.*)$/i;
const SUMMARY_RE = /^(?:summari[sz]e|recap|what\s+was\s+i\s+(?:doing|working\s+on))\b[\s,:-]*(.*)$/i;
const ASK_RE = /^(?:assistant|ask|reply(?:\s+to\s+this|\s+to)?|answer(?:\s+this)?|draft|respond|(?:is|ye)\s+(?:screen|mail|message|error)\s+(?:ko\s+|ka\s+)?(?:explain\s+karo|samjha\s*do|samjhao|batao|reply\s+likh\s*do|jawab\s+do)|explain\s+karo|samjha\s*do|samjhao|likh\s*do|jawab\s+do|ezhudhunga|kore\s*dao|समझाओ|बताओ|लिख\s*दो|जवाब\s*दो)\b[\s,:-]*(.*)$/i;

// queries referring to a saved screen
const MEMORY_REF_RE = /(?:that|which)?\s*i\s+(?:asked\s+(?:you\s+to\s+)?remember|remembered|saved|captured)|(?:from|on|in)\s+(?:the|that|my)\s+(?:remembered|saved|captured|last)?\s*(?:screen|screenshot|image|memory)|(?:from|in)\s+memory\b|from\s+that\s+screen\b|jo\s+screen\s+yaad|yaad\s+rakhne\s+(?:ko\s+)?bola/i;

// follow-up questions when a screen context is already active
const FOLLOW_UP_RE = /^(?:now\s+)?(?:explain|tell\s+me\s+more(?:\s+about)?|what\s+about|detail|elaborate(?:\s+on)?)\s+(?:step|that|it|the\s+code|the\s+error|the\s+program|the\s+function|item)\b/i;

export function detectIntent(text, hasActiveContext = false) {
  let clean = (text || '').trim().replace(/^[\s.,!?]+/, '');
  const hadPrefix = PREFIX_RE.test(clean);
  const normalized = clean.replace(PREFIX_RE, '').trim().replace(/^[\s.,!?]+/, '');

  let m = normalized.match(FIND_RE);
  if (m) return { mode: 'find', query: stripTail(m[1]) };

  m = normalized.match(REMEMBER_RE);
  if (m) return { mode: 'remember', query: stripTail(m[1]) };

  if (MEMORY_REF_RE.test(normalized) || (hasActiveContext && FOLLOW_UP_RE.test(normalized))) {
    return { mode: 'query_memory', query: stripTail(normalized) };
  }

  m = normalized.match(SUMMARY_RE);
  if (m) return { mode: 'summarize', query: stripTail(m[1]) };

  m = normalized.match(ASK_RE);
  if (m) return { mode: 'ask', query: stripTail(m[1]) };

  if (hadPrefix && normalized) {
    if (hasActiveContext && (normalized.startsWith('what') || normalized.startsWith('how') || normalized.startsWith('explain'))) {
      return { mode: 'query_memory', query: stripTail(normalized) };
    }
    return { mode: 'ask', query: stripTail(normalized) };
  }

  return { mode: 'dictate', query: clean };
}

function stripTail(s) {
  return (s || '').trim().replace(/[.!?]+$/, '').trim();
}
