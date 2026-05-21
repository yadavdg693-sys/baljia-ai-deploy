import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('deepgram service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.DEEPGRAM_API_KEY = 'test-deepgram-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('requires an API key to be configured', async () => {
    const service = await import('./deepgram.service');
    expect(service.isDeepgramConfigured()).toBe(true);

    delete process.env.DEEPGRAM_API_KEY;
    expect(service.isDeepgramConfigured()).toBe(false);
  });

  it('calls Deepgram text-to-speech and returns audio bytes', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _request?: RequestInit) => new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = await import('./deepgram.service');
    const result = await service.textToSpeech('Hello launch video');

    expect(result.audio).toEqual(Buffer.from([4, 5, 6]));
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.model).toBe('aura-2-thalia-en');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [URL, RequestInit] | undefined;
    expect(firstCall).toBeDefined();
    const [url, request] = firstCall!;
    expect(url.toString()).toContain('/v1/speak');
    expect(url.searchParams.get('model')).toBe('aura-2-thalia-en');
    expect(url.searchParams.get('encoding')).toBe('mp3');
    expect(request.headers).toMatchObject({
      Authorization: 'Token test-deepgram-key',
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(String(request.body)) as { text: string };
    expect(body.text).toBe('Hello launch video');
  });

  it('redacts secret-like details from Deepgram error messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Authorization: Token test-deepgram-key is invalid', {
      status: 401,
      statusText: 'Unauthorized',
    })));

    const service = await import('./deepgram.service');
    await expect(service.textToSpeech('Hello')).rejects.toThrow(/Authorization: Token \[redacted\]/);
  });
});
