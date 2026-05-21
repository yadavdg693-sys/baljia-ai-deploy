import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Task } from '@/types';

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  adCampaigns: {},
  adSpendLedger: {},
  platformEvents: {},
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const task = {
  id: 'task-1',
  company_id: 'company-1',
  title: 'Run ads',
} as Task;

describe('Meta ads tools', () => {
  const originalToken = process.env.META_ADS_ACCESS_TOKEN;
  const originalAccount = process.env.META_ADS_ACCOUNT_ID;
  const originalHeyGen = process.env.HEYGEN_API_KEY;
  const originalFal = process.env.FAL_KEY;

  beforeEach(() => {
    delete process.env.META_ADS_ACCESS_TOKEN;
    delete process.env.META_ADS_ACCOUNT_ID;
    delete process.env.HEYGEN_API_KEY;
    delete process.env.FAL_KEY;
  });

  afterEach(() => {
    if (originalToken) process.env.META_ADS_ACCESS_TOKEN = originalToken;
    else delete process.env.META_ADS_ACCESS_TOKEN;
    if (originalAccount) process.env.META_ADS_ACCOUNT_ID = originalAccount;
    else delete process.env.META_ADS_ACCOUNT_ID;
    if (originalHeyGen) process.env.HEYGEN_API_KEY = originalHeyGen;
    else delete process.env.HEYGEN_API_KEY;
    if (originalFal) process.env.FAL_KEY = originalFal;
    else delete process.env.FAL_KEY;
  });

  it('advertises creative_id on create_ad so video creatives can be used for ads', async () => {
    const { getMetaAdsTools } = await import('./meta-ads.tools');

    const createAd = getMetaAdsTools().find((tool) => tool.name === 'create_ad');

    expect(createAd?.input_schema.properties).toHaveProperty('creative_id');
    expect(createAd?.input_schema.required).toEqual(['adset_id', 'name']);
  });

  it('exposes an R2 persistence tool before Meta video upload', async () => {
    const { getMetaAdsTools } = await import('./meta-ads.tools');

    const names = getMetaAdsTools().map((tool) => tool.name);

    expect(names).toContain('generate_ad_video');
    expect(names).toContain('save_ad_creative_to_r2');
    expect(names.indexOf('generate_ad_video')).toBeLessThan(names.indexOf('save_ad_creative_to_r2'));
    expect(names.indexOf('save_ad_creative_to_r2')).toBeLessThan(names.indexOf('upload_ad_video'));
  });

  it('expects HeyGen or Fal before generating ad video', async () => {
    const { handleMetaAdsTool } = await import('./meta-ads.tools');

    const result = await handleMetaAdsTool('generate_ad_video', {
      prompt: '15-second founder ad',
    }, task);

    expect(result).toContain('HEYGEN_API_KEY or FAL_KEY');
  });

  it('plans an ad with a supplied creative_id even when copy fields are omitted', async () => {
    const { handleMetaAdsTool } = await import('./meta-ads.tools');

    const result = await handleMetaAdsTool('create_ad', {
      adset_id: 'adset-123',
      name: 'Baljia AI video ad',
      creative_id: 'creative-123',
    }, task);

    expect(result).toContain('planned for ad set adset-123');
    expect(result).toContain('Creative ID: creative-123');
  });

  it('keeps ad set budget and country in the planned output', async () => {
    const { handleMetaAdsTool } = await import('./meta-ads.tools');

    const result = await handleMetaAdsTool('create_adset', {
      campaign_id: 'campaign-123',
      name: 'US founders',
      daily_budget: 25,
      country: 'in',
      age_min: 21,
      age_max: 45,
    }, task);

    expect(result).toContain('Budget: $25/day');
    expect(result).toContain('Optimization: LINK_CLICKS');
    expect(result).toContain('Targeting: IN, ages 21-45');
  });

  it('blocks activation for review-before-launch tasks', async () => {
    const { handleMetaAdsTool } = await import('./meta-ads.tools');

    const result = await handleMetaAdsTool('activate_campaign', {
      campaign_id: 'campaign-123',
    }, {
      ...task,
      description: 'Approval mode: Review before launch\n- Launch gate: review_required',
    } as Task);

    expect(result).toContain('Activation blocked');
  });
});
