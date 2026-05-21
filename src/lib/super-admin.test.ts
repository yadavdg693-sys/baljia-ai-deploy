import { describe, expect, it } from 'vitest';
import {
  isSuperAdminEmail,
  isValidSuperAdminAccessKey,
  normalizeAdminEmails,
  normalizeSuperAdminCompanyFilters,
} from './super-admin';

describe('super admin helpers', () => {
  it('normalizes comma-separated admin emails', () => {
    expect(normalizeAdminEmails(' Owner@Baljia.ai, ops@baljia.ai ,, ')).toEqual([
      'owner@baljia.ai',
      'ops@baljia.ai',
    ]);
  });

  it('matches admin emails case-insensitively', () => {
    expect(isSuperAdminEmail('OWNER@BALJIA.AI', 'owner@baljia.ai')).toBe(true);
    expect(isSuperAdminEmail('user@example.com', 'owner@baljia.ai')).toBe(false);
  });

  it('requires an exact private access-key match', () => {
    expect(isValidSuperAdminAccessKey('secret-owner-key', 'secret-owner-key')).toBe(true);
    expect(isValidSuperAdminAccessKey('SECRET-OWNER-KEY', 'secret-owner-key')).toBe(false);
    expect(isValidSuperAdminAccessKey('', 'secret-owner-key')).toBe(false);
    expect(isValidSuperAdminAccessKey('secret-owner-key', '')).toBe(false);
  });

  it('normalizes owner dashboard company filters safely', () => {
    expect(
      normalizeSuperAdminCompanyFilters({
        q: [' Acme ', 'ignored'],
        lifecycle: 'trial_active',
        billingState: 'trial',
        taskHealth: 'failed',
        activity: 'quiet_7d',
        limit: 500,
      })
    ).toEqual({
      q: 'Acme',
      lifecycle: 'trial_active',
      billingState: 'trial',
      taskHealth: 'failed',
      activity: 'quiet_7d',
      limit: 100,
    });

    expect(
      normalizeSuperAdminCompanyFilters({
        lifecycle: 'unknown',
        billingState: 'unknown',
        taskHealth: 'unknown',
        activity: 'unknown',
        limit: -10,
      })
    ).toEqual({ limit: 1 });
  });
});
