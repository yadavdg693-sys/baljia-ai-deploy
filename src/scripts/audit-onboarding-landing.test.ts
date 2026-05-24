import { describe, expect, it } from 'vitest';

import { auditOnboardingLandingHtml } from './audit-onboarding-landing';

describe('onboarding landing static audit', () => {
  it('flags engineering-agent visual tells and dead links', () => {
    const findings = auditOnboardingLandingHtml(`
      <html>
        <body>
          <h1>Launch faster \u{1F680}</h1>
          <a href="#">Dead link</a>
          <section data-preview-artifact="pipeline_board">Artifact</section>
          <style>
            .card {
              border-left: 3px solid var(--accent);
              border-radius: 12px;
            }
            .hero { color: #818cf8; }
          </style>
        </body>
      </html>
    `);

    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'dead_hash_link',
      'emoji_in_heading_or_button',
      'forbidden_indigo_purple',
      'rounded_left_border_card',
    ]));
  });

  it('requires a generated artifact marker', () => {
    const findings = auditOnboardingLandingHtml('<html><body><h1>Clear promise</h1></body></html>');

    expect(findings.map((finding) => finding.code)).toContain('missing_preview_artifact');
  });
});
