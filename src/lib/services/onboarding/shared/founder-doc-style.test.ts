import { describe, expect, it } from 'vitest';
import { compactLine, compactMarkdown, compactParagraphs, stripInlineMarkdown } from './founder-doc-style';

describe('founder document style helpers', () => {
  it('preserves full content — no char/sentence chopping (LLM is constrained at prompt layer)', () => {
    // Old behavior chopped sentences/chars and produced "...USD 1." mid-figure
    // fragments. New behavior: full content passes through. Length constraints
    // belong in the prompt, not the renderer.
    const mission = compactLine(
      'Genesis exists to combine creative judgment with measurable proof. The market is shifting toward outcomes-led advertising in a measurable way.',
      220,
      1,
    );
    expect(mission).toContain('combine creative judgment');
    expect(mission).toContain('measurable way');
    expect(mission).not.toContain('  '); // collapsed whitespace

    const what = compactParagraphs(
      'Genesis provides branding, digital marketing, production, and campaign execution. The sharpened direction makes the offer easier to understand. A third sentence stays because we no longer chop.',
      1,
      430,
      2,
    );
    expect(what).toContain('A third sentence stays');
  });

  it('still respects array-count limits (max bullets, max paragraphs)', () => {
    // Structural limits stay — they cut between items, not within them.
    const result = compactMarkdown([
      '**The market has a clear wedge.**',
      '- One useful point that should stay.',
      '- Two useful point that should stay.',
      '- Three useful point that should stay.',
      '- Four useful point that should stay.',
      '- Five useful point that should stay.',
      '- Six should be hidden by max-bullets cap.',
    ].join('\n'));

    expect(result).toContain('One useful point');
    expect(result).not.toContain('Six should be hidden');
  });

  it('stripInlineMarkdown removes LLM markdown artifacts but keeps content', () => {
    expect(stripInlineMarkdown('*italic* and _also italic_ and `code` here')).toBe('italic and also italic and code here');
    expect(stripInlineMarkdown('- a bullet line\n- another')).toBe('a bullet line another');
    expect(stripInlineMarkdown('## Heading')).toBe('Heading');
    expect(stripInlineMarkdown('USD $1.97 billion market')).toBe('USD $1.97 billion market');  // dollar amounts intact
    expect(stripInlineMarkdown('e.g. one example')).toBe('e.g. one example');                  // abbrevs intact
  });

  it('stripInlineMarkdown removes "Lead.** - Detail" separator artifacts after bold strip', () => {
    // Real LLM output pattern: bold lead + literal " - " separator + detail.
    expect(stripInlineMarkdown('**Demand exists, but it needs proof.** - First useful signal here.'))
      .toBe('Demand exists, but it needs proof. First useful signal here.');
    expect(stripInlineMarkdown('**Position the wedge.** — The buyer should understand the job.'))
      .toBe('Position the wedge. The buyer should understand the job.');
  });

  it('stripInlineMarkdown preserves regular hyphens (compound words)', () => {
    expect(stripInlineMarkdown('Asia-Pacific no-show reduction')).toBe('Asia-Pacific no-show reduction');
    expect(stripInlineMarkdown('5-10 sessions per week')).toBe('5-10 sessions per week');
  });

  it('stripInlineMarkdown removes em-dashes and en-dashes globally (AI tell)', () => {
    // word—word → word, word
    expect(stripInlineMarkdown('talk to—structured, current data')).toBe('talk to, structured, current data');
    // word — word (with spaces) → word, word
    expect(stripInlineMarkdown('This platform — and only this — works.'))
      .toBe('This platform, and only this, works.');
    // En-dash treated the same way
    expect(stripInlineMarkdown('one – two – three')).toBe('one, two, three');
  });
});
