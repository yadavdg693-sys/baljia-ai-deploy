import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('heygen founder voice service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.HEYGEN_API_KEY = 'test-heygen-key';
    process.env.HEYGEN_FOUNDER_VOICE_ID = 'founder_voice_123';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('requires both HeyGen API key and founder voice id', async () => {
    const service = await import('./heygen-voice.service');
    expect(service.isFounderAvatarVoiceConfigured()).toBe(true);

    delete process.env.HEYGEN_FOUNDER_VOICE_ID;
    expect(service.isFounderAvatarVoiceConfigured()).toBe(false);
  });

  it('generates founder avatar voice audio from a returned audio URL', async () => {
    const fetchMock = vi.fn(async (url: string | URL, _request?: RequestInit) => {
      const value = url.toString();
      if (value.endsWith('/v3/voices/speech')) {
        return new Response(JSON.stringify({ data: { audio_url: 'https://audio.example/founder.mp3' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = await import('./heygen-voice.service');
    const result = await service.founderAvatarTextToSpeech('Hello founder video');

    expect(result.audio).toEqual(Buffer.from([7, 8, 9]));
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.voiceId).toBe('founder_voice_123');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    expect(firstCall).toBeDefined();
    const [, request] = firstCall!;
    expect(request.headers).toMatchObject({
      'X-Api-Key': 'test-heygen-key',
      Accept: 'application/json, audio/mpeg',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(request.body)) as {
      text: string;
      voice_id: string;
      input_type: string;
    };
    expect(body.text).toBe('Hello founder video');
    expect(body.voice_id).toBe('founder_voice_123');
    expect(body.input_type).toBe('text');
  });

  it('redacts secret-like details from HeyGen voice errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('X-Api-Key: test-heygen-key is invalid', {
      status: 401,
      statusText: 'Unauthorized',
    })));

    const service = await import('./heygen-voice.service');
    await expect(service.founderAvatarTextToSpeech('Hello')).rejects.toThrow(/\[redacted\]/);
    await expect(service.founderAvatarTextToSpeech('Hello')).rejects.not.toThrow(/test-heygen-key/);
  });
});
