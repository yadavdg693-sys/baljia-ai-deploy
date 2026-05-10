// Founder-facing document style helpers.
//
// Planning prompts ask for crisp output. These render-time helpers do
// whitespace cleanup + structural limits (max paragraphs, max bullets,
// max sentences) — they do NOT char-truncate. Char-truncation produces
// mid-clause fragments like "...before writing..." which destroys the
// founder's ability to act on the content.
//
// If LLM output exceeds expected length, the right fix is at the prompt
// layer (tighter constraints) or summarization (regenerate shorter), not
// silently chopping at the renderer.

export function collapseSpaces(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function splitSentences(value: string): string[] {
  const matches = value.match(/[^.!?]+(?:[.!?]+|$)/g);
  return (matches ?? [value])
    .map(collapseSpaces)
    .filter(Boolean);
}

/**
 * Collapse whitespace and optionally cap at maxSentences. Does NOT truncate
 * by character count — full sentence content always preserved. The maxChars
 * parameter is accepted for back-compat but ignored.
 */
export function compactLine(
  value: string | undefined | null,
  _maxChars?: number,        // eslint-disable-line @typescript-eslint/no-unused-vars
  maxSentences = 2,
): string {
  const cleaned = collapseSpaces(value);
  if (!cleaned) return '';
  const sentences = splitSentences(cleaned);
  if (sentences.length <= Math.max(1, maxSentences)) return cleaned;
  return sentences.slice(0, Math.max(1, maxSentences)).join(' ');
}

/**
 * Split into paragraphs (on \n\n), keep up to maxParagraphs, with up to
 * maxSentencesPerParagraph sentences each. No char truncation.
 */
export function compactParagraphs(
  value: string | undefined | null,
  maxParagraphs = 2,
  _maxCharsPerParagraph?: number, // eslint-disable-line @typescript-eslint/no-unused-vars
  maxSentencesPerParagraph = 2,
): string {
  const raw = (value ?? '').replace(/\r/g, '').trim();
  if (!raw) return '';

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((part) => compactLine(part, undefined, maxSentencesPerParagraph))
    .filter(Boolean);

  if (paragraphs.length === 0) return compactLine(raw, undefined, maxSentencesPerParagraph);
  return paragraphs.slice(0, maxParagraphs).join('\n\n');
}

/**
 * Render markdown-shaped content (bullets + paragraphs + a "Why now:" line)
 * with structural caps only. No char truncation. Bullet markers preserved.
 */
export function compactMarkdown(
  value: string | undefined | null,
  options: {
    maxBullets?: number;
    maxParagraphs?: number;
    maxLines?: number;
    maxCharsPerLine?: number;     // accepted for back-compat, ignored
    maxWhyNowChars?: number;      // accepted for back-compat, ignored
  } = {},
): string {
  const {
    maxBullets = 5,
    maxParagraphs = 2,
    maxLines = 8,
  } = options;

  const lines = (value ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';

  const output: string[] = [];
  let bulletCount = 0;
  let paragraphCount = 0;
  let usedWhyNow = false;

  for (const line of lines) {
    if (output.length >= maxLines) break;
    if (/^\|/.test(line)) continue;

    const bullet = line.match(/^[-*]\s+(.+)$/) ?? line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      if (bulletCount < maxBullets) {
        output.push(`- ${compactLine(bullet[1], undefined, 2)}`);
      }
      bulletCount += 1;
      continue;
    }

    if (/^why now:/i.test(line)) {
      if (!usedWhyNow) {
        output.push(compactLine(line, undefined, 2));
        usedWhyNow = true;
      }
      continue;
    }

    if (paragraphCount < maxParagraphs) {
      output.push(compactLine(line, undefined, 2));
      paragraphCount += 1;
    }
  }

  return output.join('\n');
}

/**
 * Cap an array at maxItems. Each item gets whitespace-cleaned only — no
 * char truncation. The maxChars parameter is accepted for back-compat
 * but ignored.
 */
export function compactList(items: string[], maxItems: number, _maxChars?: number): string[] { // eslint-disable-line @typescript-eslint/no-unused-vars
  return items
    .slice(0, maxItems)
    .map((item) => compactLine(item, undefined, 2))
    .filter(Boolean);
}

/**
 * Whitespace cleanup for a markdown table cell. Pipe-escape and newline-
 * collapse handled by the caller (escapeCell). No char truncation.
 */
export function compactTableCell(value: string | undefined | null, _maxChars?: number): string { // eslint-disable-line @typescript-eslint/no-unused-vars
  return compactLine(value, undefined, 1);
}
