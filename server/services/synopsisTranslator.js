/**
 * One-shot LLM translation of a movie synopsis between Czech and English.
 *
 * Unlike subtitle translation there is no job row and no polling: a synopsis
 * is a few hundred words, so the route awaits a single llmClient.complete()
 * call and returns the text. The caller passes the text to translate (which
 * may be an unsaved edit in the form) plus a little movie metadata for
 * context; nothing is read from or written to the database here.
 */

const llmClient = require('./llmClient');

const DIRECTIONS = {
  cs_to_en: { sourceLang: 'Czech', targetLang: 'English' },
  en_to_cs: { sourceLang: 'English', targetLang: 'Czech' },
};

// A festival synopsis is at most a few paragraphs; the cap is a guard against
// someone pasting a whole treatment into the field, not a real limit.
const MAX_SOURCE_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 4000;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

function isConfigured() {
  return llmClient.isConfigured();
}

/**
 * Short "what film is this" header for the prompt. Deliberately omits the
 * synopsis itself — here it is the source text, not context.
 */
function movieHeading(movie) {
  if (!movie) return null;
  const lines = [];
  const title = [movie.name_cs, movie.name_en].filter(Boolean).join(' / ');
  if (title) lines.push(`Title: ${title}`);
  if (movie.year) lines.push(`Year: ${movie.year}`);
  if (movie.director) lines.push(`Director: ${movie.director}`);
  if (movie.country) lines.push(`Country: ${movie.country}`);
  if (lines.length === 0) return null;
  return `The film this synopsis describes:\n${lines.join('\n')}`;
}

function buildSystemBlocks(direction, movie) {
  const { sourceLang, targetLang } = DIRECTIONS[direction];
  const sections = [
    `You are a professional translator working for an international film festival.
Translate a film's catalogue synopsis from ${sourceLang} to ${targetLang}.`,
  ];
  const heading = movieHeading(movie);
  if (heading) sections.push(heading);
  sections.push(`Rules:
1. Reply with a JSON object {"text": "<translation>"} and nothing else. No commentary, no notes.
2. Translate meaning, register, and tone faithfully. Keep the length close to the source — do not summarize, expand, or embellish.
3. Preserve the paragraph structure: keep the same paragraph breaks, using "\\n\\n" between paragraphs.
4. Keep the voice of a festival catalogue blurb: present tense, vivid but restrained, written for a reader who has not seen the film.
5. Leave names of people, places, and other films in their original form unless a well-established ${targetLang} form exists.
6. Translate the source as it stands. If it ends mid-sentence, so does your translation.`);

  return [{ type: 'text', text: sections.join('\n\n') }];
}

/**
 * @param {object} args
 * @param {'cs_to_en'|'en_to_cs'} args.direction
 * @param {string} args.text source synopsis
 * @param {object} [args.movie] optional {name_cs, name_en, year, director, country}
 * @returns {Promise<string>} the translated synopsis
 */
async function translateSynopsis({ direction, text, movie }) {
  const { sourceLang, targetLang } = DIRECTIONS[direction];
  const response = await llmClient.complete({
    systemBlocks: buildSystemBlocks(direction, movie),
    maxTokens: MAX_OUTPUT_TOKENS,
    jsonSchema: OUTPUT_SCHEMA,
    schemaName: 'synopsis_translation',
    stage: 'synopsis_translation',
    messages: [
      {
        role: 'user',
        content: `Translate this ${sourceLang} synopsis into ${targetLang}:\n\n${text}`,
      },
    ],
  });

  if (response.refusal) {
    throw new Error(`The model declined to translate this synopsis: ${response.refusal}`);
  }
  if (response.truncated) {
    throw new Error('The translation was cut off — the synopsis is too long');
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error('The model reply was not valid JSON');
  }
  const translated = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  if (!translated) {
    throw new Error('The model returned an empty translation');
  }
  return translated;
}

/** Provider-agnostic user-facing message, or null for non-LLM errors. */
function describeError(error) {
  return llmClient.describeError(error);
}

module.exports = {
  DIRECTIONS,
  MAX_SOURCE_CHARS,
  isConfigured,
  translateSynopsis,
  describeError,
};
