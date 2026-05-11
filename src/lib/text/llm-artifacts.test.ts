// Behaviour spec for stripLlmArtifacts. Locks the rules so a future refactor
// can't silently let ** or em-dashes leak into the founder-facing surfaces.
import { describe, it, expect } from 'vitest';
import { stripLlmArtifacts } from './llm-artifacts';

describe('stripLlmArtifacts — plain text mode (default)', () => {
  it('strips **bold** but keeps text', () => {
    expect(stripLlmArtifacts('Hello **world** here')).toBe('Hello world here');
  });

  it('strips *italic* but keeps text', () => {
    expect(stripLlmArtifacts('Hello *world* here')).toBe('Hello world here');
  });

  it('strips _italic_ but keeps text', () => {
    expect(stripLlmArtifacts('Hello _world_ here')).toBe('Hello world here');
  });

  it('strips `code` but keeps text', () => {
    expect(stripLlmArtifacts('Use `npm install` now')).toBe('Use npm install now');
  });

  it('strips ~~strike~~ but keeps text', () => {
    expect(stripLlmArtifacts('Hello ~~world~~ here')).toBe('Hello world here');
  });

  it('replaces em-dash with comma', () => {
    expect(stripLlmArtifacts('First — second')).toBe('First, second');
  });

  it('replaces en-dash with comma', () => {
    expect(stripLlmArtifacts('First – second')).toBe('First, second');
  });

  it('replaces unspaced em-dash with comma', () => {
    expect(stripLlmArtifacts('first—second')).toBe('first, second');
  });

  it('preserves hyphens in compound words', () => {
    expect(stripLlmArtifacts('no-show rate for self-publishers')).toBe('no-show rate for self-publishers');
  });

  it('preserves hyphens in numeric ranges', () => {
    expect(stripLlmArtifacts('Cost 5-10 dollars')).toBe('Cost 5-10 dollars');
  });

  it('strips leading bullets', () => {
    expect(stripLlmArtifacts('- First item')).toBe('First item');
  });

  it('strips numbered list markers', () => {
    expect(stripLlmArtifacts('1. First item')).toBe('First item');
  });

  it('strips ## headings', () => {
    expect(stripLlmArtifacts('## Heading text')).toBe('Heading text');
  });

  it('handles mixed artifacts in real LLM output', () => {
    const input = '**Lead.** — Detail about the **product** for *founders* who want growth.';
    const output = stripLlmArtifacts(input);
    expect(output).not.toContain('**');
    expect(output).not.toContain('—');
    expect(output).toContain('Lead');
    expect(output).toContain('Detail');
    expect(output).toContain('product');
    expect(output).toContain('founders');
  });

  it('handles null/undefined/empty input', () => {
    expect(stripLlmArtifacts(null)).toBe('');
    expect(stripLlmArtifacts(undefined)).toBe('');
    expect(stripLlmArtifacts('')).toBe('');
  });
});

describe('stripLlmArtifacts — markdown mode (preserveMarkdown: true)', () => {
  it('preserves **bold** for markdown rendering', () => {
    expect(stripLlmArtifacts('Hello **world** here', { preserveMarkdown: true, keepLineStructure: true }))
      .toBe('Hello **world** here');
  });

  it('preserves *italic* in markdown mode', () => {
    expect(stripLlmArtifacts('Hello *world* here', { preserveMarkdown: true, keepLineStructure: true }))
      .toBe('Hello *world* here');
  });

  it('preserves headings and bullets in markdown mode', () => {
    const input = '## Mission\n\n- First bullet\n- Second bullet';
    expect(stripLlmArtifacts(input, { preserveMarkdown: true, keepLineStructure: true }))
      .toBe('## Mission\n\n- First bullet\n- Second bullet');
  });

  it('still strips em-dashes in markdown mode (always an AI tell)', () => {
    expect(stripLlmArtifacts('Bold — text', { preserveMarkdown: true, keepLineStructure: true }))
      .toBe('Bold, text');
  });
});

describe('stripLlmArtifacts — keepLineStructure mode', () => {
  it('preserves newlines between paragraphs', () => {
    const input = 'Para one.\n\nPara two.';
    expect(stripLlmArtifacts(input, { keepLineStructure: true })).toBe('Para one.\n\nPara two.');
  });

  it('still strips bold/italic without preserveMarkdown', () => {
    const input = '**Bold** text\non new line';
    expect(stripLlmArtifacts(input, { keepLineStructure: true })).toBe('Bold text\non new line');
  });
});
