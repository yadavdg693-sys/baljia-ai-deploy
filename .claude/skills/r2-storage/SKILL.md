# Skill: R2 storage for media and ad assets

**READ THIS BEFORE storing generated media, ad creatives, screenshots, exports, or files that need a stable public URL.**

R2 is an asset store, not the app runtime. Engineering apps still deploy on Render. Use R2 when a task needs durable file storage or a public media URL for systems like Meta Ads.

## When to use R2

Use R2 for:

- Meta ad videos and images that need a public HTTPS URL.
- Generated creatives, screenshots, exports, and downloadable documents.
- User-uploaded files that should not live in the GitHub repo.
- Large static assets that should not be embedded in app code.

Do not use R2 for:

- Deploying founder apps.
- Storing database records.
- App sessions, auth state, leads, orders, or analytics.
- Private secrets or API keys.

## Platform service

The platform storage service is `src/lib/services/storage.service.ts`.

Core helpers:

- `uploadFile({ companyId, category, filename, content, contentType, isPublic })`
- `downloadFile(key)`
- `getPresignedUrl(key)`
- `getPresignedUploadUrl(companyId, category, filename, contentType)`
- `deleteFile(key)`
- `fileExists(key)`

Categories:

- `creatives`
- `screenshots`
- `documents`
- `media`
- `exports`

## Public asset flow for Meta Ads

Meta video upload tools need a public HTTPS URL.

1. Store the MP4/image in R2 with `category: 'creatives'` and `isPublic: true`.
2. Use the returned `publicUrl` or `url` as the Meta creative URL.
3. Then call the Meta Ads upload tool with that URL.
4. Save the R2 key and Meta asset ID in the task report or database if future reuse matters.

## Render app integration

If a Render app needs user uploads:

- Prefer direct browser upload using a presigned upload URL.
- Store returned R2 keys in Neon Postgres.
- Serve files by signed URL unless the asset is meant to be public.
- Validate MIME type and file size before accepting uploads.

## Naming and safety

- Scope keys by company ID.
- Use generated IDs in filenames to avoid collisions.
- Keep original filenames only as metadata.
- Do not trust client-provided content type.
- Do not expose private files with public URLs.
- Delete unused ad creative files when campaigns are retired if storage cost matters.

## Verification

An R2-backed asset task is done when:

1. Upload succeeds and returns a key.
2. Public files return HTTP 200 from the public URL.
3. Private files can produce a presigned URL.
4. The consuming tool, such as Meta video upload, accepts the URL.
5. The task report includes the R2 key, public URL if any, and downstream asset ID if created.
