import { describe, expect, it } from 'vitest';

import { stripPlanningHarnessMetadata } from './planning-text';

describe('planning text sanitizer', () => {
  it('removes harness instructions while preserving product contract sections', () => {
    const cleaned = stripPlanningHarnessMetadata([
      'Build and deploy this app: Vendor compliance portal.',
      '',
      'Use the normal Engineering app-build workflow before implementation:',
      '1. Call list_skills and read relevant skills for frontend, Neon/Postgres, Render, verification, Stripe/payments, uploads, AI/RAG, realtime/cron/email when applicable.',
      '2. Call match_capabilities with domain/product context.',
      '',
      'Required app surface:',
      '- Vendors upload insurance documents.',
      '- Admins approve submissions on an operations dashboard.',
      '',
      'Required verification:',
      '- Call verify_interaction_contract for auth_session, booking_reservation, payment_checkout, upload_file, ai_action, or generic_feature.',
      '- For AI text generation in founder/user apps, use the fixed Gemini provider contract.',
      '',
      'Exact live API contract the deployed app must satisfy:',
      '- POST /api/vendors accepts vendor_email and company_name.',
    ].join('\n'));

    expect(cleaned).toContain('Build and deploy this app: Vendor compliance portal.');
    expect(cleaned).toContain('Required app surface:');
    expect(cleaned).toContain('Vendors upload insurance documents.');
    expect(cleaned).toContain('Exact live API contract');
    expect(cleaned).not.toContain('Stripe/payments');
    expect(cleaned).not.toContain('payment_checkout');
    expect(cleaned).not.toContain('fixed Gemini provider contract');
  });
});
