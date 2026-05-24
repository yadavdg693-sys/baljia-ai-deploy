import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('supertonic service', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is enabled when Supertonic is requested as the promo voice provider', async () => {
    const service = await import('./supertonic.service');
    expect(service.isSupertonicConfigured()).toBe(false);

    process.env.PROMO_VIDEO_TTS_PROVIDER = 'supertonic';
    expect(service.isSupertonicConfigured()).toBe(true);
  });

  it('builds the local Supertonic Python SDK payload from the GitHub package contract', async () => {
    const service = await import('./supertonic.service');
    const payload = service.buildSupertonicPayload('Hello launch video', {
      voice: 'F3',
      lang: 'en',
      steps: 5,
      speed: 1.08,
    });

    expect(payload).toEqual({
      text: 'Hello launch video',
      voice: 'F3',
      lang: 'en',
      steps: 5,
      speed: 1.08,
    });
  });

  it('uses the documented Supertonic Python SDK entrypoint', async () => {
    const service = await import('./supertonic.service');
    const script = service.buildSupertonicPythonScript();

    expect(script).toContain('from supertonic import TTS');
    expect(script).toContain('TTS(auto_download=True)');
    expect(script).toContain('tts.get_voice_style');
    expect(script).toContain('tts.save_audio');
  });
});
