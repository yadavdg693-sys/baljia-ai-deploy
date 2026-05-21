import { describe, expect, it } from 'vitest';
import { engineeringRuntimeAddendum } from './prompt-assembly';

describe('engineering runtime prompt assembly', () => {
  it('injects bounded lane packets with scoped context hints', () => {
    const prompt = engineeringRuntimeAddendum({
      taskText: 'Build a full stack construction operations app',
      task: {
        title: 'Build construction ops',
        description: 'Track projects, bids, safety logs, and equipment.',
        tag: 'engineering',
      },
      contextPacket: {
        memory_layers: {
          l1_domain_knowledge: 'Construction customers need safety logs and equipment tracking.',
          l2_user_preferences: 'Founder prefers dense operational dashboards.',
          l3_cross_company: '',
        },
        prior_reports: [],
        failure_fingerprints: [],
        company_state: { lifecycle: 'trial_active', billing_state: 'trial' },
        compiled_briefing: '',
        codebase_map: 'Routes: /projects',
      },
    });

    expect(prompt).toContain('## Engineering Lane Packets');
    expect(prompt).toContain('FRONTEND Lane Packet');
    expect(prompt).toContain('BACKEND Lane Packet');
    expect(prompt).toContain('Founder prefers dense operational dashboards');
    expect(prompt).toContain('codebase_map=present');
  });
});
