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
    expect(stripInlineMarkdown('**Bold** lead - normal text.')).toBe('Bold lead - normal text.');
    expect(stripInlineMarkdown('*italic* and _also italic_ and `code` here')).toBe('italic and also italic and code here');
    expect(stripInlineMarkdown('- a bullet line\n- another')).toBe('a bullet line another');
    expect(stripInlineMarkdown('## Heading')).toBe('Heading');
    expect(stripInlineMarkdown('USD $1.97 billion market')).toBe('USD $1.97 billion market');  // dollar amounts intact
    expect(stripInlineMarkdown('e.g. one example')).toBe('e.g. one example');                  // abbrevs intact
  });
});
