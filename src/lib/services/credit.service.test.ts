import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Drizzle db
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  creditLedger: {},
  platformEvents: {},
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Credit Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('deductCredit', () => {
    it('rejects negative amounts', async () => {
      const { deductCredit } = await import('@/lib/services/credit.service');

      await expect(
        deductCredit('company-1', -5, 'task-1', 'test')
      ).rejects.toThrow('Deduction amount must be positive');
    });

    it('rejects zero amount', async () => {
      const { deductCredit } = await import('@/lib/services/credit.service');

      await expect(
        deductCredit('company-1', 0, 'task-1', 'test')
      ).rejects.toThrow('Deduction amount must be positive');
    });
  });

  describe('addCredit', () => {
    it('rejects negative amounts', async () => {
      const { addCredit } = await import('@/lib/services/credit.service');

      await expect(
        addCredit('company-1', -10, 'addon_purchase', 'test')
      ).rejects.toThrow('addCredit amount must be positive');
    });

    it('rejects zero amount', async () => {
      const { addCredit } = await import('@/lib/services/credit.service');

      await expect(
        addCredit('company-1', 0, 'addon_purchase', 'test')
      ).rejects.toThrow('addCredit amount must be positive');
    });
  });
});
