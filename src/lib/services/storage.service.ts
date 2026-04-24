// Cloudflare R2 Storage Service — S3-compatible object storage
// Used for ad creatives, generated media, agent screenshots, documents
//
// Cloudflare R2 uses the S3 API with a custom endpoint.
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger } from '@/lib/logger';
import { nanoid } from 'nanoid';

const log = createLogger('Storage');

// ══════════════════════════════════════════════
// R2 CLIENT (lazy init)
// ══════════════════════════════════════════════

let r2Client: S3Client | null = null;

function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  return r2Client;
}

function getBucket(): string {
  return process.env.R2_BUCKET_NAME!;
}

function getPublicUrl(key: string): string {
  const customUrl = process.env.R2_PUBLIC_URL;
  if (customUrl) return `${customUrl.replace(/\/$/, '')}/${key}`;
  return `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`;
}

// ══════════════════════════════════════════════
// UPLOAD — put files into R2
// ══════════════════════════════════════════════

interface UploadOptions {
  /** Company ID for path scoping */
  companyId: string;
  /** File category: 'creatives', 'screenshots', 'documents', 'media', 'exports' */
  category: 'creatives' | 'screenshots' | 'documents' | 'media' | 'exports';
  /** Original filename or desired filename */
  filename: string;
  /** File content as Buffer or string */
  content: Buffer | string;
  /** MIME type */
  contentType: string;
  /** Optional: make publicly accessible via R2 public URL */
  isPublic?: boolean;
}

interface UploadResult {
  key: string;
  url: string;
  publicUrl?: string;
  size: number;
}

export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  if (!isR2Configured()) {
    log.warn('R2 not configured — file upload skipped', { filename: options.filename });
    // Return a placeholder so agents don't crash
    return {
      key: `placeholder/${options.filename}`,
      url: `https://placeholder.r2.dev/${options.filename}`,
      size: typeof options.content === 'string' ? options.content.length : options.content.byteLength,
    };
  }

  const client = getR2Client();
  const ext = options.filename.split('.').pop() ?? 'bin';
  const key = `${options.companyId}/${options.category}/${nanoid(12)}.${ext}`;

  const body = typeof options.content === 'string' ? Buffer.from(options.content) : options.content;

  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: options.contentType,
    // Metadata for traceability
    Metadata: {
      'company-id': options.companyId,
      'original-name': options.filename,
      'category': options.category,
    },
  }));

  const size = body.byteLength;
  log.info('File uploaded to R2', { key, size, contentType: options.contentType });

  return {
    key,
    url: getPublicUrl(key),
    publicUrl: options.isPublic ? getPublicUrl(key) : undefined,
    size,
  };
}

// ══════════════════════════════════════════════
// DOWNLOAD — get files from R2
// ══════════════════════════════════════════════

export async function downloadFile(key: string): Promise<{ content: Buffer; contentType: string } | null> {
  if (!isR2Configured()) return null;

  try {
    const client = getR2Client();
    const response = await client.send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));

    if (!response.Body) return null;

    const chunks: Uint8Array[] = [];
    // AWS SDK v3 Body is a ReadableStream on Node18+ and is async-iterable.
    // We cast to the iterable shape; SDK types mark Body as a union that
    // includes non-iterable types (Blob on browsers), but at runtime on
    // Node it's always iterable.
    const body = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of body) {
      chunks.push(chunk);
    }

    return {
      content: Buffer.concat(chunks),
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    log.error('R2 download failed', { key }, error);
    return null;
  }
}

// ══════════════════════════════════════════════
// PRESIGNED URL — temporary access links (1 hour)
// ══════════════════════════════════════════════

export async function getPresignedUrl(key: string, expiresInSec = 3600): Promise<string | null> {
  if (!isR2Configured()) return null;

  try {
    const client = getR2Client();
    return await getSignedUrl(client, new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }), { expiresIn: expiresInSec });
  } catch (error) {
    log.error('Presigned URL generation failed', { key }, error);
    return null;
  }
}

/**
 * Get a presigned upload URL so the client can upload directly to R2.
 * Avoids routing large files through our server.
 */
export async function getPresignedUploadUrl(
  companyId: string,
  category: UploadOptions['category'],
  filename: string,
  contentType: string,
  expiresInSec = 3600
): Promise<{ uploadUrl: string; key: string } | null> {
  if (!isR2Configured()) return null;

  try {
    const ext = filename.split('.').pop() ?? 'bin';
    const key = `${companyId}/${category}/${nanoid(12)}.${ext}`;

    const client = getR2Client();
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
      Metadata: {
        'company-id': companyId,
        'original-name': filename,
        'category': category,
      },
    }), { expiresIn: expiresInSec });

    return { uploadUrl, key };
  } catch (error) {
    log.error('Presigned upload URL failed', { companyId, filename }, error);
    return null;
  }
}

// ══════════════════════════════════════════════
// DELETE — remove files from R2
// ══════════════════════════════════════════════

export async function deleteFile(key: string): Promise<boolean> {
  if (!isR2Configured()) return false;

  try {
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));
    log.info('File deleted from R2', { key });
    return true;
  } catch (error) {
    log.error('R2 delete failed', { key }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// EXISTS — check if file exists
// ══════════════════════════════════════════════

export async function fileExists(key: string): Promise<boolean> {
  if (!isR2Configured()) return false;

  try {
    const client = getR2Client();
    await client.send(new HeadObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}
