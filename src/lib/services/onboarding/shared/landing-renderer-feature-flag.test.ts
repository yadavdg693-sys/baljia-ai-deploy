import { describe, expect, it } from 'vitest';

import { utilityCardsV2Body, utilityCardsV2Styles } from './landing-renderer-v2';

const baseContent = {
  brand: { name: 'FlagFixture', tagline: 'Focused workflow software for teams' },
  hero: {
    headline: 'Coordinate work before the day starts.',
    subhead: 'FlagFixture gives teams a focused daily operating view. It keeps decisions, signals, and next steps in one readable place.',
  },
  what_it_does: {
    heading: 'What it does',
    capabilities: [
      { title: 'Track signals', description: 'Collects the important changes from trusted sources.' },
      { title: 'Rank decisions', description: 'Shows which changes need action and who owns them.' },
      { title: 'Share briefings', description: 'Turns the strongest items into a short daily read.' },
    ],
  },
  how_it_works: {
    heading: 'How it works',
    steps: [
      { number: 1, title: 'Connect sources', description: 'Pick the channels and categories worth watching.' },
      { number: 2, title: 'Set priorities', description: 'Define what counts as important for the team.' },
      { number: 3, title: 'Read the brief', description: 'Review the changes that should shape the day.' },
    ],
  },
  what_makes_different: {
    heading: 'Why this is different',
    points: [
      'It stays focused on decisions instead of dashboards.',
      'It makes the preview useful without promising a finished product.',
      'It keeps the engineering source of truth separate from the page.',
    ],
  },
  closing: {
    headline: 'A focused preview, not a product contract.',
    body: 'The page helps the founder see shape while canonical onboarding inputs drive the build.',
  },
};

const esc = (value: string) => value;

describe('landing renderer preview gating', () => {
  it('keeps the existing utility-card style when preview mode is off', () => {
    const styles = utilityCardsV2Styles(false);
    const body = utilityCardsV2Body(baseContent, 2026, esc);

    expect(styles).toContain('border-left: 3px solid var(--accent);');
    expect(styles).not.toContain('preview-artifact');
    expect(body).not.toContain('data-preview-artifact=');
    expect(body).not.toContain('preview-hero');
  });

  it('uses preview-safe card chrome only when preview mode and content are present', () => {
    const styles = utilityCardsV2Styles(true);
    const body = utilityCardsV2Body({
      ...baseContent,
      generator_version: 'v2',
      template_kind: 'saas',
      preview_summary: {
        audience: 'Lean operating teams',
        problem: 'Daily signals are scattered',
        positioning: 'A short briefing instead of another dashboard',
      },
      artifact: {
        kind: 'pipeline_board',
        title: 'Signal Priority Board',
        items: [
          { label: 'Pricing', value: 'Tier changed', detail: 'Review packaging before the next sales call.' },
          { label: 'Hiring', value: 'Role added', detail: 'Competitor is moving into enterprise accounts.' },
          { label: 'Reviews', value: 'Setup friction', detail: 'Lead with onboarding clarity in positioning.' },
        ],
      },
    }, 2026, esc);

    expect(styles).toContain('border-top: 3px solid var(--accent);');
    expect(styles).not.toMatch(/\.card\s*\{[^}]*border-left\s*:[^}]*border-radius/);
    expect(body).toContain('data-preview-artifact="pipeline_board"');
    expect(body).toContain('preview-hero');
  });

  it('does not render preview UI when preview fields arrive without v2 metadata', () => {
    const styles = utilityCardsV2Styles(false);
    const body = utilityCardsV2Body({
      ...baseContent,
      generator_version: 'v1',
      template_kind: 'saas',
      preview_summary: {
        audience: 'Lean operating teams',
        problem: 'Daily signals are scattered',
        positioning: 'A short briefing instead of another dashboard',
      },
      artifact: {
        kind: 'pipeline_board',
        title: 'Signal Priority Board',
        items: [
          { label: 'Pricing', value: 'Tier changed', detail: 'Review packaging before the next sales call.' },
          { label: 'Hiring', value: 'Role added', detail: 'Competitor is moving into enterprise accounts.' },
          { label: 'Reviews', value: 'Setup friction', detail: 'Lead with onboarding clarity in positioning.' },
        ],
      },
    }, 2026, esc);

    expect(styles).not.toContain('preview-artifact');
    expect(body).not.toContain('data-preview-artifact=');
    expect(body).not.toContain('preview-hero');
  });
});
