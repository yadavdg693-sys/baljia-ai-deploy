// Payment Crypto — AES-256-GCM via Web Crypto API for founder-supplied
// payment provider secrets (Stripe / Razorpay).
//
// Why a separate helper from `credential-crypto.ts`:
//   - `credential-crypto.ts` uses `node:crypto` directly; this one uses the
//     Web Crypto API (`globalThis.crypto.subtle`).
//   - Web Crypto is portable: it works in Node 19+ (current Render runtime),
//     in edge runtimes, and in any future CF Workers path without changes.
//   - Keeps payment-credential encryption isolated from the Codex OAuth
//     token store (different lifecycle, different threat model, different
//     consumers — easier to audit when they live in separate files).
//
// Storage format (JSON, base64-encoded fields):
//   { v: 1, iv: <12B>, value: <ciphertext || auth_tag> }
//
// Master key derivation: SHA-256(AUTH_SECRET). Same env var as credential-crypto.

const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;
const KEY_USAGES: KeyUsage[] = ['encrypt', 'decrypt'];

interface EncryptedPayloadV1 {
  v: 1;
  iv: string;     // base64
  value: string;  // base64 (ciphertext || auth_tag, Web Crypto returns them concatenated)
}

let cachedKey: CryptoKey | null = null;

async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const seed = process.env.AUTH_SECRET || process.env.BALJIA_MASTER_KEY;
  if (!seed) throw new Error('AUTH_SECRET is required for payment credential encryption');
  const seedBytes = new TextEncoder().encode(seed);
  const keyBytes = await crypto.subtle.digest('SHA-256', seedBytes);
  cachedKey = await crypto.subtle.importKey('raw', keyBytes, ALGORITHM, false, KEY_USAGES);
  return cachedKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  // CF-Workers + Node compat: avoid Buffer (not always available on CF).
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  // Allocate via ArrayBuffer so the resulting Uint8Array has a plain ArrayBuffer
  // backing store (matches BufferSource without a cast on strict TS configs).
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptPaymentSecret(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('encryptPaymentSecret: empty plaintext');
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, data);
  const payload: EncryptedPayloadV1 = {
    v: 1,
    iv: bytesToBase64(iv),
    value: bytesToBase64(new Uint8Array(encrypted)),
  };
  return JSON.stringify(payload);
}

export async function decryptPaymentSecret(payload: string): Promise<string> {
  if (!payload) throw new Error('decryptPaymentSecret: empty payload');
  const parsed = JSON.parse(payload) as EncryptedPayloadV1;
  if (parsed.v !== 1) throw new Error(`decryptPaymentSecret: unsupported version ${parsed.v}`);
  const key = await getMasterKey();
  const iv = base64ToBytes(parsed.iv);
  const ciphertext = base64ToBytes(parsed.value);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv: iv as BufferSource }, key, ciphertext as BufferSource);
  return new TextDecoder().decode(decrypted);
}

// Convenience: redact a key for display (sk_test_abcd...wxyz)
export function redactKey(key: string): string {
  if (!key || key.length < 12) return '***';
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}
