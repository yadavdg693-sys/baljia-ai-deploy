import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, resolveCompanyIdentifier, isApiError } from '@/lib/api-utils';
import { uploadFile } from '@/lib/services/storage.service';

export const runtime = 'nodejs';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ['image/'];
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

function cleanFilename(name: string): string {
  return name
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 120) || 'attachment';
}

function isAllowedContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return ALLOWED_MIME_TYPES.has(normalized)
    || ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function fileCategory(contentType: string): 'documents' | 'media' {
  return contentType.toLowerCase().startsWith('image/') ? 'media' : 'documents';
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const rawCompanyId = form.get('company_id');

  if (typeof rawCompanyId !== 'string') {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }

  const companyId = await resolveCompanyIdentifier(rawCompanyId);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const files = form.getAll('files').filter((item): item is File => item instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'At least one file is required.' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Attach up to ${MAX_FILES} files at once.` }, { status: 400 });
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: 'Attachments can be up to 25 MB total.' }, { status: 400 });
  }

  const uploaded = [];
  for (const file of files) {
    const contentType = file.type || 'application/octet-stream';
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${file.name} is larger than 10 MB.` }, { status: 400 });
    }
    if (!isAllowedContentType(contentType)) {
      return NextResponse.json({ error: `${file.name} is not a supported attachment type.` }, { status: 400 });
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile({
      companyId,
      category: fileCategory(contentType),
      filename: cleanFilename(file.name),
      content,
      contentType,
      isPublic: true,
    });

    uploaded.push({
      name: file.name,
      type: contentType,
      size: file.size,
      key: result.key,
      url: result.publicUrl ?? result.url,
    });
  }

  return NextResponse.json({ attachments: uploaded });
}
