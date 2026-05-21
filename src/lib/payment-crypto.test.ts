import { describe, it, expect, beforeAll } from 'vitest';
import { encryptPaymentSecret, decryptPaymentSecret, redactKey } from './payment-crypto';

beforeAll(() => {
  // Crypto helper reads AUTH_SECRET as the master-key seed.
  process.env.AUTH_SECRET = 'test-suite-master-key-do-not-use-in-prod';
});

describe('payment-crypto', () => {
  it('round-trips a Stripe-style secret key', async () => {
    const plaintext = 'sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const enc = await encryptPaymentSecret(plaintext);
    expect(enc).toBeTruthy();
    expect(enc).not.toContain(plaintext);
    const dec = await decryptPaymentSecret(enc);
    expect(dec).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    const plaintext = 'sk_live_super_secret';
    const a = await encryptPaymentSecret(plaintext);
    const b = await encryptPaymentSecret(plaintext);
    expect(a).not.toBe(b);
    expect(await decryptPaymentSecret(a)).toBe(plaintext);
    expect(await decryptPaymentSecret(b)).toBe(plaintext);
  });

  it('encrypted payload is parseable JSON with version 1', async () => {
    const enc = await encryptPaymentSecret('whsec_abc');
    const parsed = JSON.parse(enc);
    expect(parsed.v).toBe(1);
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.value).toBe('string');
  });

  it('rejects tampered ciphertext', async () => {
    const enc = await encryptPaymentSecret('sk_test_intact');
    const tampered = enc.replace(/"value":"[^"]/, '"value":"X');
    await expect(decryptPaymentSecret(tampered)).rejects.toThrow();
  });

  it('round-trips long Razorpay-style secrets', async () => {
    const plaintext = 'abcdef0123456789abcdef0123456789abcdef0123456789';
    const enc = await encryptPaymentSecret(plaintext);
    expect(await decryptPaymentSecret(enc)).toBe(plaintext);
  });

  it('round-trips multibyte UTF-8 (just to be safe)', async () => {
    const plaintext = 'sk_test_émoji_🔐_unicode';
    const enc = await encryptPaymentSecret(plaintext);
    expect(await decryptPaymentSecret(enc)).toBe(plaintext);
  });

  it('redactKey returns a short display string', () => {
    expect(redactKey('sk_test_51HelloWorldThisIsTheFullKey123')).toBe('sk_test_...y123');
    expect(redactKey('short')).toBe('***');
    expect(redactKey('')).toBe('***');
  });
});
