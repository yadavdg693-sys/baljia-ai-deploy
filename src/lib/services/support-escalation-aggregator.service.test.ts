import { describe, expect, it } from 'vitest';

import {
  buildSupportFeedbackDraft,
  clusterSupportEscalationEvents,
  supportEscalationFingerprint,
  type SupportEscalationEvent,
} from './support-escalation-aggregator.service';

const baseEvent = (overrides: Partial<SupportEscalationEvent>): SupportEscalationEvent => ({
  id: 'evt-base',
  company_id: 'company-1',
  event_type: 'support_escalation',
  payload: {
    type: 'support_escalation',
    urgency: 'high',
    summary: 'Dashboard tasks disappear after approval',
    customer_email: 'customer@example.com',
  },
  created_at: new Date('2026-05-19T08:00:00Z'),
  ...overrides,
});

describe('support escalation aggregation', () => {
  it('groups repeated support escalations by stable fingerprint', () => {
    const events = [
      baseEvent({ id: 'evt-1' }),
      baseEvent({ id: 'evt-2', payload: { type: 'support_escalation', urgency: 'medium', summary: 'Dashboard tasks disappear after approval', customer_email: 'second@example.com' } }),
      baseEvent({ id: 'evt-3', payload: { type: 'support_escalation', urgency: 'critical', summary: 'Dashboard tasks disappear after approval' } }),
      baseEvent({ id: 'evt-noise', payload: { type: 'support_escalation', urgency: 'low', summary: 'Billing receipt typo' } }),
    ];

    const clusters = clusterSupportEscalationEvents(events, { minOccurrences: 3 });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      companyId: 'company-1',
      area: 'dashboard',
      fingerprint: supportEscalationFingerprint({
        area: 'dashboard',
        summary: 'Dashboard tasks disappear after approval',
      }),
      severity: 'critical',
    });
    expect(clusters[0]?.events.map((event) => event.id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(clusters[0]?.customerEmails).toEqual(['customer@example.com', 'second@example.com']);
  });

  it('turns an escalation cluster into a platform feedback draft with source evidence', () => {
    const [cluster] = clusterSupportEscalationEvents([
      baseEvent({ id: 'evt-1' }),
      baseEvent({ id: 'evt-2' }),
      baseEvent({ id: 'evt-3' }),
    ], { minOccurrences: 3 });

    const draft = buildSupportFeedbackDraft(cluster!);

    expect(draft).toMatchObject({
      company_id: 'company-1',
      type: 'bug',
      source: 'support',
      area: 'dashboard',
      status: 'open',
      severity: 'high',
      occurrence_count: 3,
      fingerprint: cluster!.fingerprint,
    });
    expect(draft.title).toContain('Dashboard tasks disappear after approval');
    expect(draft.description).toContain('Aggregated from 3 support escalations');
    expect(draft.description).toContain('evt-1');
    expect(draft.metadata).toMatchObject({
      kind: 'support_escalation_cluster',
      event_ids: ['evt-1', 'evt-2', 'evt-3'],
      customer_emails: ['customer@example.com'],
    });
  });
});
