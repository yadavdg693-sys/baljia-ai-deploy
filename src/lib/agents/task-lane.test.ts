import { describe, expect, it } from 'vitest';

import {
  applyTaskLaneCreateDefaults,
  applyTaskLaneRuntimePolicy,
  classifyTaskLane,
  engineeringLaneToolGate,
  getTaskLanePolicy,
} from './task-lane';

describe('task lane policy', () => {
  it('classifies simple copy, UI, and API repairs as fast', () => {
    expect(classifyTaskLane({
      title: 'Fix button label',
      description: 'Change the primary CTA button copy on the existing page.',
      tag: 'engineering',
    })).toBe('fast');

    expect(classifyTaskLane({
      title: 'Add one API route',
      description: 'Add one endpoint that returns server status JSON.',
      tag: 'api',
    })).toBe('fast');
  });

  it('classifies normal generated apps as standard', () => {
    expect(classifyTaskLane({
      title: 'Build local service booking app',
      description: 'Create a booking website with a dashboard and appointment form.',
      tag: 'engineering',
    })).toBe('standard');
  });

  it('promotes OAuth, payments, RAG, and security tasks to strict', () => {
    expect(classifyTaskLane({
      title: 'Fix OAuth login',
      description: 'Repair Google OAuth session handling for the existing app.',
      tag: 'engineering',
    })).toBe('strict');

    expect(classifyTaskLane({
      title: 'Add Stripe checkout',
      description: 'Customers can buy subscriptions and see invoices.',
      tag: 'engineering',
    })).toBe('strict');
  });

  it('keeps explicit canary harness tasks in canary lane only through a canary tag', () => {
    expect(classifyTaskLane({
      title: 'Render evaluation local-service-booking',
      description: 'Run the adversarial world-class canary and replay the original canary after repair.',
      tag: 'engineering-canary',
      complexity: 10,
    })).toBe('canary');
  });

  it('recognizes explicit CANARY strict replay harness tasks without promoting product wording', () => {
    expect(classifyTaskLane({
      title: 'CANARY ecommerce-store strict replay',
      description: 'World-class canary run with final replay.',
      tag: 'engineering',
      complexity: 10,
    })).toBe('canary');
  });

  it('does not route user-facing canary products into the canary lane by wording alone', () => {
    expect(classifyTaskLane({
      title: 'Build canary monitoring dashboard',
      description: 'Users track deployment canaries, confidence runs, status history, and service health.',
      tag: 'engineering',
      complexity: 3,
    })).toBe('standard');
  });

  it('does not let planning harness skill lists promote a normal app to strict lane', () => {
    expect(classifyTaskLane({
      title: 'Build operations dashboard',
      description: [
        'Build and deploy this app: Operations dashboard.',
        '',
        'Use the normal Engineering app-build workflow before implementation:',
        '1. Call list_skills and read relevant skills for frontend, Neon/Postgres, Render, verification, Stripe/payments, uploads, AI/RAG, realtime/cron/email when applicable.',
        '',
        'Required app surface:',
        '- Users create status records.',
        '- Operators review the records on an operations dashboard.',
      ].join('\n'),
      tag: 'engineering',
      complexity: 3,
    })).toBe('standard');
  });

  it('applies create defaults only when caller omitted values', () => {
    const fast = applyTaskLaneCreateDefaults({
      title: 'Fix small button style',
      description: 'Narrow UI polish on existing page.',
      tag: 'engineering',
    });
    expect(fast).toMatchObject({
      complexity: 1,
      execution_mode: 'template_plus_params',
      verification_level: 'deterministic',
      estimated_credits: 1,
      max_turns: 150,
    });

    const explicit = applyTaskLaneCreateDefaults({
      title: 'Fix small button style',
      description: 'Narrow UI polish on existing page.',
      tag: 'engineering',
      complexity: 4,
      execution_mode: 'full_agent' as const,
      verification_level: 'hybrid' as const,
      estimated_credits: 9,
      max_turns: 99,
    });
    expect(explicit).toMatchObject({
      complexity: 4,
      execution_mode: 'full_agent',
      verification_level: 'hybrid',
      estimated_credits: 9,
      max_turns: 99,
    });
  });

  it('caps runtime turns by lane for Engineering only', () => {
    const runtime = applyTaskLaneRuntimePolicy({
      title: 'Fix typo',
      description: 'Small copy fix.',
      tag: 'engineering',
      max_turns: 200,
    }, 30);
    expect(runtime.max_turns).toBe(150);

    const browserTask = applyTaskLaneRuntimePolicy({
      title: 'Fix typo',
      description: 'Small copy fix.',
      tag: 'engineering',
      max_turns: 200,
    }, 42);
    expect(browserTask.max_turns).toBe(200);

    const canaryTask = applyTaskLaneRuntimePolicy({
      title: 'Render evaluation ecommerce-store',
      description: 'World-class canary run.',
      tag: 'engineering-canary',
      max_turns: 260,
    }, 30);
    expect(canaryTask.max_turns).toBe(200);
  });

  it('hard-caps explicit Engineering lane task creation max turns at 200', () => {
    const canary = applyTaskLaneCreateDefaults({
      title: 'Render evaluation ecommerce-store',
      description: 'World-class canary run.',
      tag: 'engineering-canary',
      max_turns: 260,
    });

    expect(canary.max_turns).toBe(200);
  });

  it('uses 150 turns as the default for every Engineering lane', () => {
    const lanes: Array<{ title: string; description: string; tag: string; max_turns?: number | null }> = [
      {
        title: 'Fix typo',
        description: 'Small copy fix.',
        tag: 'engineering',
      },
      {
        title: 'Build local service booking app',
        description: 'Create a booking website with dashboard and appointment form.',
        tag: 'engineering',
      },
      {
        title: 'Fix OAuth login',
        description: 'Repair Google OAuth session handling.',
        tag: 'engineering',
      },
      {
        title: 'Render evaluation ecommerce-store',
        description: 'World-class canary run.',
        tag: 'engineering-canary',
      },
    ];

    for (const task of lanes) {
      expect(applyTaskLaneCreateDefaults(task).max_turns).toBe(150);
    }
  });

  it('blocks expensive optional tools in fast lane but not canary lane', () => {
    const fastTask = {
      title: 'Fix button spacing',
      description: 'Small existing UI repair.',
      tag: 'engineering',
    };
    expect(engineeringLaneToolGate('design_critique', [], fastTask)).toContain('fast lane');
    expect(engineeringLaneToolGate('create_report', [], fastTask)).toContain('fast lane');
    expect(engineeringLaneToolGate('match_reference_repos', [], fastTask)).toContain('fast lane');

    const canaryTask = {
      title: 'Render evaluation ecommerce-store strict replay',
      description: 'World-class canary repair with report.',
      tag: 'engineering-canary',
    };
    expect(getTaskLanePolicy(canaryTask).lane).toBe('canary');
    expect(engineeringLaneToolGate('design_critique', [], canaryTask)).toBeNull();
  });
});
