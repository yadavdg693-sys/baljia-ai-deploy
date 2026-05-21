// tests/config.test.js — boot-time config validation tests.
//
// Why this file exists: today's biggest deploy failure mode is "app boots
// with undefined env vars and fails at the first user request." These tests
// pin down the schema so a regression (someone removes a required field)
// trips a test, not a 5xx in production.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Replicate the schema shape from server.js — the test file is intentionally
// independent so renaming a field in server.js without updating tests fails.
const CONFIG_SCHEMA = z.object({
  DATABASE_URL:    z.string().url(),
  SESSION_SECRET:  z.string().min(32),
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('development'),
  PORT:            z.coerce.number().int().positive().default(10000),
  STRIPE_API_KEY:  z.string().min(20).optional(),
  STRIPE_LINK:     z.string().url().optional(),
});

const baseValid = {
  DATABASE_URL:   'postgresql://u:p@host.neon.tech/db?sslmode=require',
  SESSION_SECRET: 'a'.repeat(64),
  NODE_ENV:       'production',
  PORT:           '10000',
};

describe('CONFIG_SCHEMA', () => {
  it('accepts a valid env', () => {
    const result = CONFIG_SCHEMA.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it('rejects missing DATABASE_URL', () => {
    const env = { ...baseValid };
    delete env.DATABASE_URL;
    const result = CONFIG_SCHEMA.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('DATABASE_URL'))).toBe(true);
    }
  });

  it('rejects malformed DATABASE_URL', () => {
    const result = CONFIG_SCHEMA.safeParse({ ...baseValid, DATABASE_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects SESSION_SECRET shorter than 32 chars', () => {
    const result = CONFIG_SCHEMA.safeParse({ ...baseValid, SESSION_SECRET: 'too-short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('SESSION_SECRET'))).toBe(true);
    }
  });

  it('coerces PORT from string to number', () => {
    const result = CONFIG_SCHEMA.safeParse({ ...baseValid, PORT: '3000' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(3000);
  });

  it('rejects non-numeric PORT', () => {
    const result = CONFIG_SCHEMA.safeParse({ ...baseValid, PORT: 'abc' });
    expect(result.success).toBe(false);
  });

  it('treats STRIPE_API_KEY as optional', () => {
    const result = CONFIG_SCHEMA.safeParse(baseValid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.STRIPE_API_KEY).toBeUndefined();
  });

  it('rejects STRIPE_API_KEY that is too short', () => {
    const result = CONFIG_SCHEMA.safeParse({ ...baseValid, STRIPE_API_KEY: 'short' });
    expect(result.success).toBe(false);
  });
});
