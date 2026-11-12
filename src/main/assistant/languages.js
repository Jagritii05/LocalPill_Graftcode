// Language configurations for multilingual dictation and screen assistant prompts.

export const SUPPORTED_LANGUAGES = {
  en: {
    code: 'en',
    name: 'English',
    styleGuide: 'Respond in clear, concise everyday English.',
  },
  'hi-IN': {
    code: 'hi-IN',
    name: 'Hinglish / Conversational Hindi',
    styleGuide:
      'Respond in natural everyday conversational Hinglish (spoken Hindi written in Roman/English letters mixed with common English UI terms like screen, error, button, form, box, click, submit, upload, link). Avoid formal or archaic pure Hindi words like "त्रुटि", "प्रपत्र", or "संलग्न".',
  },
  'ta-IN': {
    code: 'ta-IN',
    name: 'Conversational Tamil / Tanglish',
    styleGuide:
      'Respond in natural everyday conversational Tamil mixed with English UI words (Tanglish) like screen, error, button, form, click pannunga. Avoid archaic literary Tamil words.',
  },
  'bn-IN': {
    code: 'bn-IN',
    name: 'Conversational Bengali / Benglish',
    styleGuide:
      'Respond in natural everyday conversational Bengali mixed with English UI words (Benglish) like screen, error, button, form, click korun. Avoid formal bookish Sanskritized words.',
  },
  'te-IN': {
    code: 'te-IN',
    name: 'Conversational Telugu / Tenglish',
    styleGuide:
      'Respond in natural everyday conversational Telugu mixed with common English UI terms (screen, button, form, error, click). Avoid formal literary wording.',
  },
  'kn-IN': {
    code: 'kn-IN',
    name: 'Conversational Kannada / Kanglish',
    styleGuide:
      'Respond in natural everyday conversational Kannada mixed with common English UI terms (screen, button, form, error, click). Avoid overly formal wording.',
  },
  'mr-IN': {
    code: 'mr-IN',
    name: 'Conversational Marathi',
    styleGuide:
      'Respond in natural everyday Marathi mixed with common English UI terms (screen, button, form, error, click).',
  },
  'gu-IN': {
    code: 'gu-IN',
    name: 'Conversational Gujarati',
    styleGuide:
      'Respond in natural everyday Gujarati mixed with common English UI terms (screen, button, form, error, click).',
  },
  auto: {
    code: 'auto',
    name: 'Auto-detect',
    styleGuide:
      'Match the language and script of the user query. If the user asks in Hinglish or another Indian language, respond naturally in that language mixed with standard English UI terms.',
  },
};

export function getLanguageConfig(langCode) {
  if (!langCode) return SUPPORTED_LANGUAGES.en;
  const normalized = String(langCode).trim().toLowerCase();
  for (const [key, conf] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (key.toLowerCase() === normalized || conf.name.toLowerCase().includes(normalized)) {
      return conf;
    }
  }
  return SUPPORTED_LANGUAGES.en;
}

export function isIndicLanguage(langCode) {
  if (!langCode) return false;
  const low = String(langCode).trim().toLowerCase();
  return low !== 'en' && low !== 'en-us' && low !== 'en-in';
}

