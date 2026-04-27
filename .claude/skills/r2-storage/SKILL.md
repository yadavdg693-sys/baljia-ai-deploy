# Skill: R2 storage (file uploads, static assets)

**READ THIS BEFORE adding file upload, image hosting, or any blob storage to a founder app.**

R2 is Cloudflare's S3-compatible object store. Free egress, S3 API, and best of all — exposed to your Worker as a binding (no API tokens, no CORS pain).

## Get R2 access — pass the flag on deploy

```
cf_deploy_app({
  slug: 'foundercorp',
  script_content: '...',
  with_r2_assets: true,  // ← mounts the platform's R2 bucket as env.ASSETS
})
```

After this, `env.ASSETS` is an `R2Bucket` instance inside the Worker. No keys, no signing, no AWS SDK needed.

## API — what env.ASSETS gives you

```js
// Read
const obj = await env.ASSETS.get('uploads/avatar-123.jpg');
if (!obj) return new Response('not found', { status: 404 });
return new Response(obj.body, {
  headers: {
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'cache-control': 'public, max-age=3600',
    'etag': obj.httpEtag,
  },
});

// Write
await env.ASSETS.put('uploads/avatar-123.jpg', request.body, {
  httpMetadata: {
    contentType: request.headers.get('content-type') ?? 'application/octet-stream',
  },
  customMetadata: {
    uploaded_by: userId,
    uploaded_at: new Date().toISOString(),
  },
});

// Delete
await env.ASSETS.delete('uploads/avatar-123.jpg');

// List
const list = await env.ASSETS.list({ prefix: 'uploads/', limit: 100 });
for (const obj of list.objects) {
  console.log(obj.key, obj.size, obj.uploaded);
}
```

## File upload pattern (multipart-free)

```js
// Client sends file as raw body. NO multipart/form-data needed.
// Browser side:
async function upload(file) {
  return fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file, // file is a Blob — fetch streams it
  });
}

// Worker handler:
app.post('/api/upload', async (c) => {
  const filename = c.req.query('name');
  const key = `uploads/${crypto.randomUUID()}-${filename}`;
  await c.env.ASSETS.put(key, c.req.raw.body, {
    httpMetadata: { contentType: c.req.header('content-type') ?? 'application/octet-stream' },
  });
  return c.json({ key, url: `https://${c.env.COMPANY_SUBDOMAIN}.baljia.app/files/${key}` });
});
```

## Serving files — proxy through your Worker

R2 buckets aren't publicly readable by default (and you don't want them to be — anyone can list). Serve via your Worker:

```js
app.get('/files/*', async (c) => {
  const key = c.req.path.replace(/^\/files\//, '');
  const obj = await c.env.ASSETS.get(key);
  if (!obj) return c.notFound();

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': obj.customMetadata?.public === 'true'
        ? 'public, max-age=86400'
        : 'private, no-cache',
      'etag': obj.httpEtag,
    },
  });
});
```

For high-traffic public assets (avatars, blog images), enable Cloudflare caching by setting `cache-control: public, max-age=86400` and the response will be cached at the edge automatically.

## Size + format limits

| Limit | Value |
|---|---|
| Max object size | 5 GB (single PUT) / 5 TB (multipart) |
| Max metadata | 2 KB total per object |
| Listing pagination | 1000 keys per page |
| Free tier egress | UNLIMITED (this is R2's killer feature) |
| Free tier requests | 10M Class A / month, 1M Class B / month |

## Naming conventions used across founder apps

```
uploads/{userId}/{uuid}-{filename}    ← user-uploaded files (private by default)
public/{type}/{filename}              ← assets the founder app intentionally exposes
generated/{timestamp}-{hash}.{ext}    ← AI-generated content
backups/{date}.json                   ← snapshots
```

Use UUIDs in keys to avoid collisions. Don't use `Date.now()` — multiple uploads in the same ms break.

## Don't do these

- ❌ **Importing AWS SDK (`@aws-sdk/client-s3`)** — works on Workers but ships ~300 KB and you don't need it. Use `env.ASSETS` directly.
- ❌ **Using `multer` or any Express middleware for file parsing** — Workers doesn't run Express. Use the raw body pattern above.
- ❌ **Reading file content into memory before checking size** — for large uploads, stream straight to R2 and reject if `content-length` exceeds your limit.
- ❌ **Trusting `request.headers.get('content-type')` for file type validation** — clients lie. Sniff the magic bytes if security matters: `const buf = await request.arrayBuffer(); const sig = new Uint8Array(buf, 0, 4);` then check known signatures (PNG: `89 50 4E 47`, JPEG: `FF D8 FF`).
- ❌ **Storing PII filenames as keys** — `uploads/john-smith-passport.pdf` shows up in any debug log. Always use UUID-prefixed keys.

## Verification

After adding R2 features:

1. PUT a file → GET it back → DELETE it → confirm 404
2. Upload a 5 MB file (cf_deploy worker has 100 MB request body limit; for >100 MB use multipart)
3. Verify content-type round-trips correctly
4. If serving publicly: confirm caching headers work via `curl -I https://<slug>.baljia.app/files/<key>` — look for `cf-cache-status: HIT` after a few requests

A storage task is NOT done if "I added the put/get code." It's done when a real file uploaded, downloaded byte-identical, and the deletion path works.
