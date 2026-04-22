// Credential Crypto — AES-256-GCM encryption for stored OAuth tokens
// Ported from App_mode/src/lib/credential-crypto.mjs

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

interface EncryptedPayload {
  iv: string;
  tag: string;
  value: string;
}

export function encryptSecret(plaintext: string): string | null {
  if (!plaintext) return null;

  const iv = crypto.randomBytes(12);
  const key = getMasterKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    value: encrypted.toString('base64'),
  } satisfies EncryptedPayload);
}

export function decryptSecret(payload: string): string | null {
  if (!payload) return null;

  // Two on-disk formats coexist:
  //   1. New (current): JSON `{iv, tag, value}` — produced by encryptSecret() above
  //   2. Legacy: dot-separated `iv.ciphertext.tag` (3 base64 parts) — written by the
  //      original App_mode/Polsia port of balaji-openai-codex-oauth.mjs. Existing
  //      Codex OAuth credential files on disk use this format. Detect by leading char.
  const trimmed = payload.trimStart();
  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;

  if (trimmed.startsWith('{')) {
    const parsed: EncryptedPayload = JSON.parse(payload);
    iv = Buffer.from(parsed.iv, 'base64');
    tag = Buffer.from(parsed.tag, 'base64');
    ciphertext = Buffer.from(parsed.value, 'base64');
  } else {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error(`decryptSecret: legacy format expected 3 dot-separated parts, got ${parts.length}`);
    }
    iv = Buffer.from(parts[0], 'base64');
    ciphertext = Buffer.from(parts[1], 'base64');
    tag = Buffer.from(parts[2], 'base64');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getMasterKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function getMasterKey(): Buffer {
  // Use AUTH_SECRET (already required by Baljia) as the master key seed
  const seed = process.env.AUTH_SECRET || process.env.BALJIA_MASTER_KEY;
  if (!seed) throw new Error('AUTH_SECRET is required for credential encryption');
  return crypto.createHash('sha256').update(seed).digest();
}
