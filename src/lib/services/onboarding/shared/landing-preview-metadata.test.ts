import { describe, expect, it } from 'vitest';

import { createLandingSourceIdeaHash, getLandingPreviewFreshness } from './landing-preview-metadata';

const baseContext = {
  journey: 'build_my_idea',
  input: 'A job search app for candidates tracking applications.',
  oneLiner: 'Application tracking for focused candidates',
  missionDoc: {
    one_liner: 'Track the job search clearly',
    mission: 'Help candidates keep their job search organized.',
    what_were_building: 'A simple workspace for applications, resumes, and follow-ups.',
    where_were_headed: 'A focused operating system for the job search.',
  },
  refinedIdea: {
    refined_idea: 'A job search tracker that scores openings and manages applications.',
    changes_made: 'Focused the idea on application operations.',
    rationale: 'The founder needs a clear first product surface.',
  },
  inventedIdea: undefined,
  businessProfile: undefined,
  onboardingBrief: {
    journey: 'build_my_idea',
    founder: {
      name: null,
      email: 'founder@example.com',
      location: null,
      timezone: null,
      enrichment_confidence: 'low',
      angle: null,
    },
    input: 'A job search app for candidates tracking applications.',
    subject: {
      kind: 'idea',
      name: null,
      summary: 'A job search app for candidates tracking applications.',
      source: 'founder_input',
    },
    evidence: {
      has_founder_angle: false,
      has_business_profile: false,
      has_founder_background: false,
    },
    confidence: 'medium',
  },
} as const;

describe('landing preview metadata', () => {
  it('marks a preview fresh when the stored source hash matches', () => {
    const sourceHash = createLandingSourceIdeaHash(baseContext);
    const freshness = getLandingPreviewFreshness({
      ...baseContext,
      landingPageBrief: {
        url: null,
        headline: 'Track every application',
        subhead: 'A concise preview.',
        tagline: 'Job search operations',
        capabilities: [],
        steps: [],
        differentiators: [],
        generator_version: 'v2',
        source_idea_hash: sourceHash,
      },
    });

    expect(freshness.status).toBe('fresh');
    expect(freshness.shouldRegenerate).toBe(false);
  });

  it('marks a preview stale when the founder idea source changes', () => {
    const sourceHash = createLandingSourceIdeaHash(baseContext);
    const freshness = getLandingPreviewFreshness({
      ...baseContext,
      input: 'A marketplace matching home chefs with office lunch buyers.',
      landingPageBrief: {
        url: null,
        headline: 'Track every application',
        subhead: 'A concise preview.',
        tagline: 'Job search operations',
        capabilities: [],
        steps: [],
        differentiators: [],
        generator_version: 'v2',
        source_idea_hash: sourceHash,
      },
    });

    expect(freshness.status).toBe('stale');
    expect(freshness.shouldRegenerate).toBe(true);
  });

  it('uses unknown freshness for legacy previews without metadata', () => {
    const freshness = getLandingPreviewFreshness({
      ...baseContext,
      landingPageBrief: {
        url: null,
        headline: 'Track every application',
        subhead: 'A concise preview.',
        tagline: 'Job search operations',
        capabilities: [],
        steps: [],
        differentiators: [],
      },
    });

    expect(freshness.status).toBe('unknown');
    expect(freshness.shouldRegenerate).toBe(false);
  });
});
