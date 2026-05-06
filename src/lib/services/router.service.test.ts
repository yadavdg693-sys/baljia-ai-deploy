// Unit tests for the router service — focused on getCreditCostForTask, the
// new credit-pricing helper that drives heavy-Browser-task billing.

import { describe, it, expect } from 'vitest';
import { routeTask, getAgentName, getCreditCostForTask } from './router.service';

describe('routeTask', () => {
  it('routes browser tags to agent 42', () => {
    expect(routeTask('scrape')).toBe(42);
    expect(routeTask('account-setup')).toBe(42);
    expect(routeTask('form-fill')).toBe(42);
  });

  it('routes engineering tags to agent 30', () => {
    expect(routeTask('landing-page')).toBe(30);
    expect(routeTask('api')).toBe(30);
    expect(routeTask('billing')).toBe(30);
  });

  it('falls back to engineering (30) for unknown tags', () => {
    expect(routeTask('totally-unknown-tag-xyz')).toBe(30);
  });
});

describe('getAgentName', () => {
  it('maps known IDs to display names', () => {
    expect(getAgentName(42)).toBe('Browser');
    expect(getAgentName(30)).toBe('Engineering');
    expect(getAgentName(0)).toBe('CEO');
  });

  it('falls back to Engineering for unknown IDs', () => {
    expect(getAgentName(999)).toBe('Engineering');
  });
});

describe('getCreditCostForTask', () => {
  describe('Browser-routed tasks (agent 42)', () => {
    it('charges 1 credit for low complexity (1-6)', () => {
      expect(getCreditCostForTask('scrape', 1)).toBe(1);
      expect(getCreditCostForTask('scrape', 3)).toBe(1);
      expect(getCreditCostForTask('scrape', 5)).toBe(1);
      expect(getCreditCostForTask('scrape', 6)).toBe(1);
    });

    it('charges 2 credits for high complexity (7-10)', () => {
      expect(getCreditCostForTask('scrape', 7)).toBe(2);
      expect(getCreditCostForTask('account-setup', 8)).toBe(2);
      expect(getCreditCostForTask('form-fill', 10)).toBe(2);
    });

    it('flips at the 7 threshold exactly', () => {
      expect(getCreditCostForTask('scrape', 6)).toBe(1);
      expect(getCreditCostForTask('scrape', 7)).toBe(2);
    });
  });

  describe('Non-Browser tasks always charge 1 credit regardless of complexity', () => {
    it('Engineering tasks always 1 credit', () => {
      expect(getCreditCostForTask('landing-page', 3)).toBe(1);
      expect(getCreditCostForTask('landing-page', 7)).toBe(1);
      expect(getCreditCostForTask('api', 10)).toBe(1);
    });

    it('Research tasks always 1 credit', () => {
      expect(getCreditCostForTask('research', 5)).toBe(1);
      expect(getCreditCostForTask('research', 9)).toBe(1);
    });

    it('Data tasks always 1 credit', () => {
      expect(getCreditCostForTask('analytics', 8)).toBe(1);
      expect(getCreditCostForTask('sql', 10)).toBe(1);
    });
  });
});
