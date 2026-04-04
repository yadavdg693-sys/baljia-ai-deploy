import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/server before importing the module under test
vi.mock('next/server', () => {
  class MockNextResponse {
    public status: number;
    public body: unknown;
    public headers: Map<string, string>;

    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Map(Object.entries(init?.headers ?? {}));
    }

    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(body, init);
    }
  }

  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

// We need to test the core logic directly since checkRateLimit depends on NextRequest
// Import after mocking
import { checkCompanyRateLimit } from '@/lib/rate-limiter';

describe('Rate Limiter', () => {
  describe('checkCompanyRateLimit', () => {
    beforeEach(() => {
      // Reset the rate limiter store by importing a fresh module
      // Since it's in-memory, we just wait for the window to expire or use a unique company
    });

    it('allows requests under the limit', () => {
      const companyId = `test-company-${Date.now()}-under`;
      const result = checkCompanyRateLimit(companyId, { maxRequests: 5, windowMs: 60000 });
      expect(result).toBeNull();
    });

    it('allows exactly maxRequests requests', () => {
      const companyId = `test-company-${Date.now()}-exact`;
      const opts = { maxRequests: 3, windowMs: 60000 };

      // First 3 should pass
      expect(checkCompanyRateLimit(companyId, opts)).toBeNull();
      expect(checkCompanyRateLimit(companyId, opts)).toBeNull();
      expect(checkCompanyRateLimit(companyId, opts)).toBeNull();
    });

    it('blocks requests over the limit with 429', () => {
      const companyId = `test-company-${Date.now()}-over`;
      const opts = { maxRequests: 2, windowMs: 60000 };

      // First 2 pass
      checkCompanyRateLimit(companyId, opts);
      checkCompanyRateLimit(companyId, opts);

      // Third should be blocked
      const result = checkCompanyRateLimit(companyId, opts);
      expect(result).not.toBeNull();
      expect((result as any).status).toBe(429);
    });

    it('resets after window expires', async () => {
      const companyId = `test-company-${Date.now()}-reset`;
      const opts = { maxRequests: 1, windowMs: 50 }; // Very short window

      // First passes
      expect(checkCompanyRateLimit(companyId, opts)).toBeNull();

      // Second blocked
      expect(checkCompanyRateLimit(companyId, opts)).not.toBeNull();

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should pass again
      expect(checkCompanyRateLimit(companyId, opts)).toBeNull();
    });

    it('tracks different companies independently', () => {
      const opts = { maxRequests: 1, windowMs: 60000 };
      const company1 = `test-company-${Date.now()}-ind1`;
      const company2 = `test-company-${Date.now()}-ind2`;

      expect(checkCompanyRateLimit(company1, opts)).toBeNull();
      expect(checkCompanyRateLimit(company2, opts)).toBeNull();

      // company1 should be blocked but company2 still has capacity
      expect(checkCompanyRateLimit(company1, opts)).not.toBeNull();
    });

    it('uses default options when none provided', () => {
      const companyId = `test-company-${Date.now()}-defaults`;
      // Default is 30 req/min — just verify one call works
      const result = checkCompanyRateLimit(companyId);
      expect(result).toBeNull();
    });
  });
});
