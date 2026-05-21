import { describe, expect, it } from 'vitest';

import { classifyTaskIntent, formatTaskIntentEvidence, parseTaskIntent } from './task-intent';

describe('task intent classifier', () => {
  it('classifies new builds, existing extensions, and focused repairs separately', () => {
    expect(classifyTaskIntent({
      title: 'Build booking app',
      description: 'Create a full-stack booking app with slots and admin views.',
    }).intent).toBe('new_app_build');

    expect(classifyTaskIntent({
      title: 'Extend existing app',
      description: 'Update the existing repo with billing and preserve current routes.',
    }).intent).toBe('existing_app_extension');

    expect(classifyTaskIntent({
      title: 'CEO repair task',
      description: 'Fix the existing app. The original canary failed because Save document did not render saved data. Use the same repo and service.',
    })).toMatchObject({
      intent: 'focused_repair',
      lane: 'repair',
    });
  });

  it('specializes focused fixes for API, auth, and deployment risk', () => {
    expect(classifyTaskIntent({
      title: 'Fix API contract',
      description: 'Repair failed POST payload contract for snake_case fields.',
    }).intent).toBe('api_contract_fix');

    expect(classifyTaskIntent({
      title: 'Fix sign out',
      description: 'Repair broken signout session behavior.',
    }).intent).toBe('auth_security_fix');

    expect(classifyTaskIntent({
      title: 'Fix Render deploy',
      description: 'Deployment failed because Render build logs show missing env var.',
    }).intent).toBe('deployment_fix');
  });

  it('formats and parses deterministic evidence', () => {
    const result = classifyTaskIntent({ title: 'Fix button copy', description: 'Update one page button label.' });
    const marker = formatTaskIntentEvidence(result);

    expect(marker).toContain('TASK_INTENT_EVIDENCE');
    expect(parseTaskIntent(result.intent)).toBe(result.intent);
    expect(parseTaskIntent('not-real')).toBeNull();
  });
});
