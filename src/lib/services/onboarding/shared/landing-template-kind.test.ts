import { describe, expect, it } from 'vitest';

import { resolveLandingTemplateKind, artifactKindForTemplate } from './landing-template-kind';

describe('landing template kind resolution', () => {
  it('maps job-search automation into a SaaS pipeline preview', () => {
    const kind = resolveLandingTemplateKind({
      journey: 'build_my_idea',
      industryId: 'productivity_tool',
      text: 'AI job search agent that scans postings, scores fit, tailors resumes, and tracks applications.',
    });

    expect(kind).toBe('saas');
    expect(artifactKindForTemplate(kind)).toBe('pipeline_board');
  });

  it('keeps grow-my-company previews in the existing-business lane', () => {
    const kind = resolveLandingTemplateKind({
      journey: 'grow_my_company',
      industryId: 'restaurant',
      text: 'Local restaurant wants more catering leads and repeat customers.',
    });

    expect(kind).toBe('existing_business');
    expect(artifactKindForTemplate(kind)).toBe('growth_snapshot');
  });

  it('uses category-specific preview kinds beyond SaaS', () => {
    expect(resolveLandingTemplateKind({
      journey: 'build_my_idea',
      industryId: 'online_store',
      text: 'DTC skincare storefront with product drops and subscriptions.',
    })).toBe('ecommerce');

    expect(resolveLandingTemplateKind({
      journey: 'build_my_idea',
      industryId: 'coaching',
      text: 'A cohort course and coaching program for first-time founders.',
    })).toBe('content_coaching');

    expect(resolveLandingTemplateKind({
      journey: 'surprise_me',
      industryId: 'marketplace',
      text: 'Marketplace matching home chefs with office lunch buyers.',
    })).toBe('marketplace');
  });
});
