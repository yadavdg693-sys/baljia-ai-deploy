import { beforeAll, describe, expect, it } from 'vitest';
import { promoVideoRequestSchema } from '@/lib/validations';
import { getCreditCostForTask } from './router.service';

let promoCore: typeof import('./promo-video-core.service');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/baljia_test';
  promoCore = await import('./promo-video-core.service');
});

describe('promo video request schema', () => {
  it('accepts supported options and defaults', () => {
    const parsed = promoVideoRequestSchema.parse({ company_id: 'company-1' });
    expect(parsed.goal).toBe('demo');
    expect(parsed.duration_seconds).toBe(30);
    expect(parsed.aspect_ratio).toBe('9:16');
    expect(parsed.style).toBe('product_demo');
    expect(parsed.visual_mode).toBe('cinematic');
    expect(parsed.voice_mode).toBe('deepgram');
  });

  it('accepts the Product Hunt launch goal', () => {
    const parsed = promoVideoRequestSchema.parse({
      company_id: 'company-1',
      goal: 'product_hunt',
      duration_seconds: 60,
      aspect_ratio: '16:9',
      visual_mode: 'actual_site',
      voice_mode: 'supertonic',
    });

    expect(parsed.goal).toBe('product_hunt');
    expect(parsed.voice_mode).toBe('supertonic');
  });

  it('rejects unsupported duration and option values', () => {
    expect(() => promoVideoRequestSchema.parse({
      company_id: 'company-1',
      goal: 'viral',
      duration_seconds: 45,
      aspect_ratio: '4:5',
      style: 'ugc_avatar',
      visual_mode: 'screenshot_only',
      voice_mode: 'celebrity',
    })).toThrow();

    expect(() => promoVideoRequestSchema.parse({
      company_id: 'company-1',
      voice_mode: 'ai_voiceover',
    })).toThrow();
  });
});

describe('promo video helper logic', () => {
  it('calculates credits by requested length', () => {
    expect(promoCore.getPromoVideoCreditCost(15)).toBe(2);
    expect(promoCore.getPromoVideoCreditCost(30)).toBe(2);
    expect(promoCore.getPromoVideoCreditCost(60)).toBe(3);
    expect(promoCore.getPromoVideoCreditCost(90)).toBe(4);
  });

  it('defaults Product Hunt CTAs to a launch-ready CTA', () => {
    expect(promoCore.getDefaultPromoVideoCta('product_hunt', 'LaunchPad', null)).toBe('Try LaunchPad on Product Hunt');
    expect(promoCore.getDefaultPromoVideoCta('demo', 'LaunchPad', null)).toBe('Try LaunchPad');
    expect(promoCore.getDefaultPromoVideoCta('product_hunt', 'LaunchPad', 'Vote today')).toBe('Vote today');
  });

  it('routes promo-video credit cost through task router complexity', () => {
    expect(getCreditCostForTask('promo-video', 5)).toBe(2);
    expect(getCreditCostForTask('promo-video', 7)).toBe(3);
    expect(getCreditCostForTask('promo-video', 9)).toBe(4);
  });

  it('selects live URL by custom domain, subdomain, then slug', () => {
    expect(promoCore.resolvePromoVideoLiveUrl({
      slug: 'fallback',
      subdomain: 'demo',
      custom_domain: 'example.com',
    })).toBe('https://example.com');

    expect(promoCore.resolvePromoVideoLiveUrl({
      slug: 'fallback',
      subdomain: 'demo',
      custom_domain: null,
    })).toBe('https://demo.baljia.app');

    expect(promoCore.resolvePromoVideoLiveUrl({
      slug: 'fallback',
      subdomain: null,
      custom_domain: null,
    })).toBe('https://fallback.baljia.app');
  });

  it('normalizes storyboard scene durations to the requested total', () => {
    const scenes = promoCore.normalizeSceneDurations([
      { duration_seconds: 100 },
      { duration_seconds: 10 },
      { duration_seconds: 1 },
    ], 30);

    expect(scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0)).toBe(30);
    expect(scenes.every((scene) => scene.duration_seconds >= 1)).toBe(true);
  });
});
