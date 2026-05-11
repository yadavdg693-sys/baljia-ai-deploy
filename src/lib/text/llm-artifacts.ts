// Strip LLM-generated artifacts (bold/italic markers, em/en-dashes, headings,
// bullet markers, leftover separators) from text before it reaches the
// founder-facing UI.
//
// This is the SINGLE canonical implementation. All callers — onboarding
// renderers, task/document service chokepoints, CEO tool handlers — must
// import from here. Do not duplicate.
//
// Two modes:
//   - plain text (tasks, one-liners, landing): strip everything inline +
//     bullets, headings, em/en-dashes. Markdown markers leak through to
//     the dashboard as literal characters in these surfaces.
//   - markdown (mission doc, market research): preserve **bold**, *italic*,
//     headings, lists — they render correctly in the markdown viewer.
//     ONLY em/en-dashes get stripped (they always look like AI tell).
//     Set `preserveMarkdown: true` for this mode.

interface StripOpts {
  /** Keep newlines + leading bullets/headings (markdown context). */
  keepLineStructure?: boolean;
  /** Keep **bold**, *italic*, _italic_, `code` — they render correctly
   *  in markdown contexts. Em/en-dashes are still stripped. */
  preserveMarkdown?: boolean;
}

export function stripLlmArtifacts(
  value: string | undefined | null,
  opts: StripOpts = {},
): string {
  if (!value) return '';
  let s = String(value);

  if (!opts.preserveMarkdown) {
    // Bold/italic/strike: remove the markers but keep the text inside.
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '$1');     // **bold**
    s = s.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '$1'); // *italic*
    s = s.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '$1');   // _italic_
    s = s.replace(/~~([^~\n]+?)~~/g, '$1');         // ~~strike~~
    s = s.replace(/`([^`\n]+?)`/g, '$1');           // `code`
    s = s.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, '$1');
  }

  if (!opts.keepLineStructure) {
    // Strip line-structure markers — content goes to plain text.
    s = s.replace(/(^|\n)\s*[-*+]\s+/g, '$1');
    s = s.replace(/(^|\n)\s*\d+[.)]\s+/g, '$1');
    s = s.replace(/(^|\n)#{1,6}\s+/g, '$1');
  }

  // Clean leftover "lead — detail" separators after sentence-ending
  // punctuation (artifact of stripped bold markers).
  s = s.replace(/([.!?])[ \t]+[-–—][ \t]+/g, '$1 ');

  // Strip em-dashes / en-dashes globally — strong AI tell, replaced with a
  // comma so prose still reads correctly. Always stripped regardless of
  // preserveMarkdown.
  //   word—word     → word, word
  //   word — word   → word, word
  //   word– word    → word, word
  // Regular hyphens are preserved (compound words, ranges).
  s = s.replace(/[ \t]*[—–][ \t]*/g, ', ');

  if (!opts.keepLineStructure) {
    s = s.replace(/^\s*[-–—]\s+/, '');
    s = s.replace(/\s+[-–—]\s*$/, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  return s.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
}
