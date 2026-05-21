import { describe, expect, it } from 'vitest';
import { shouldHideOwnerPathBeforeAuth } from './super-admin-routing';

describe('super admin owner routing', () => {
  it('hides wrong owner slugs before the login redirect', () => {
    expect(shouldHideOwnerPathBeforeAuth('/owner/wrong-slug', 'real-slug')).toBe(true);
    expect(shouldHideOwnerPathBeforeAuth('/owner/wrong-slug/audit', 'real-slug')).toBe(true);
  });

  it('allows the configured owner slug to continue to auth checks', () => {
    expect(shouldHideOwnerPathBeforeAuth('/owner/real-slug', 'real-slug')).toBe(false);
    expect(shouldHideOwnerPathBeforeAuth('/owner/real-slug/billing', 'real-slug')).toBe(false);
  });
});
