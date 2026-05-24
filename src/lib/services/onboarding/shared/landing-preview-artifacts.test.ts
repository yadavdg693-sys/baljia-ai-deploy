import { describe, expect, it } from 'vitest';

import { renderPreviewArtifact, renderPreviewProofRail } from './landing-preview-artifacts';
import type { LandingArtifactKind } from './landing-template-kind';

const esc = (value: string) => value;

function contentFor(kind: LandingArtifactKind) {
  return {
    generator_version: 'v2' as const,
    template_kind: 'saas' as const,
    preview_summary: {
      audience: 'Lean teams with daily decisions',
      problem: 'Important work is scattered',
      positioning: 'A concrete preview instead of generic cards',
    },
    artifact: {
      kind,
      title: `${kind} Preview`,
      items: [
        { label: 'Intake', value: 'New request', detail: 'A qualified opportunity is ready to review.' },
        { label: 'Review', value: 'Priority set', detail: 'The highest-impact next step is called out.' },
        { label: 'Action', value: 'Owner assigned', detail: 'The workflow has a clear follow-up path.' },
      ],
    },
  };
}

describe('landing preview artifacts', () => {
  it.each([
    ['pipeline_board', 'preview-board'],
    ['app_dashboard', 'preview-dashboard'],
    ['booking_flow', 'preview-flow'],
    ['storefront_drop', 'preview-storefront'],
    ['coaching_map', 'preview-program'],
    ['marketplace_match', 'preview-match'],
    ['growth_snapshot', 'preview-growth'],
    ['service_scope', 'preview-scope'],
    ['general_snapshot', 'preview-snapshot'],
  ] as const)('renders %s with a distinct artifact layout', (kind, className) => {
    const html = renderPreviewArtifact(contentFor(kind), esc);

    expect(html).toContain(`data-preview-artifact="${kind}"`);
    expect(html).toContain(className);
  });

  it('does not render preview markup unless the generator version is v2', () => {
    const content = {
      ...contentFor('pipeline_board'),
      generator_version: 'v1' as const,
    };

    expect(renderPreviewArtifact(content, esc)).toBe('');
  });

  it('brands the proof rail as Baljia-created work', () => {
    const html = renderPreviewProofRail(contentFor('pipeline_board'), esc);

    expect(html).toContain('What Baljia created during onboarding');
    expect(html).not.toContain('Polsia');
  });
});
