// Verifies R2 S3-compatible access works end-to-end:
// 1. HEAD the bucket (auth check)
// 2. PUT a test object
// 3. GET it back
// 4. DELETE it
// Run: npx tsx scripts/test-r2-access.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  console.log('R2_ACCOUNT_ID:',        accountId ? `${accountId.slice(0, 8)}...` : 'MISSING');
  console.log('R2_ACCESS_KEY_ID:',     accessKeyId ? `${accessKeyId.slice(0, 8)}...` : 'MISSING');
  console.log('R2_SECRET_ACCESS_KEY:', secretAccessKey ? '<set>' : 'MISSING');
  console.log('R2_BUCKET_NAME:',       bucket ?? 'MISSING');

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error('FAIL — missing R2 env vars');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  // 1. HEAD bucket
  console.log('\n[1] HEAD bucket...');
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log('   PASS — bucket reachable');
  } catch (err) {
    console.error('   FAIL — HEAD bucket failed:', (err as Error).message);
    process.exit(1);
  }

  // 2. PUT a test object
  const testKey = `founder-apps/__smoketest__/index.html`;
  const testHtml = `<!DOCTYPE html><html><body><h1>R2_SMOKE_TEST_OK</h1><p>Uploaded at ${new Date().toISOString()}</p></body></html>`;
  console.log(`\n[2] PUT ${testKey}...`);
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: Buffer.from(testHtml, 'utf-8'),
      ContentType: 'text/html; charset=utf-8',
    }));
    console.log(`   PASS — uploaded ${testHtml.length} bytes`);
  } catch (err) {
    console.error('   FAIL — PUT failed:', (err as Error).message);
    process.exit(1);
  }

  // 3. GET it back
  console.log(`\n[3] GET ${testKey}...`);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: testKey }));
    const bodyText = await res.Body?.transformToString();
    if (bodyText === testHtml) {
      console.log('   PASS — content matches');
    } else {
      console.error('   FAIL — content mismatch');
      console.error('   expected len:', testHtml.length, 'got len:', bodyText?.length);
      process.exit(1);
    }
  } catch (err) {
    console.error('   FAIL — GET failed:', (err as Error).message);
    process.exit(1);
  }

  // 4. DELETE
  console.log(`\n[4] DELETE ${testKey}...`);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
    console.log('   PASS — deleted');
  } catch (err) {
    console.error('   FAIL — DELETE failed:', (err as Error).message);
    process.exit(1);
  }

  console.log('\n✅ R2 end-to-end works. baljia-assets is reachable with platform credentials.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
