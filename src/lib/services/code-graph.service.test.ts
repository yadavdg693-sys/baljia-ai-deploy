import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as documentService from './document.service';

vi.mock('@/lib/db', () => ({
  db: {},
  companies: {},
  documents: {},
}));

vi.mock('@/lib/services/github-throttle', () => ({
  githubFetch: vi.fn(),
}));

vi.mock('./document.service', () => ({
  getDocumentByType: vi.fn(),
  updateDocument: vi.fn(),
}));

describe('code graph safe file filtering', () => {
  it('allows text code files the runtime graph can inspect', async () => {
    const { shouldIncludeCodeGraphPath } = await import('./code-graph.service');

    expect(shouldIncludeCodeGraphPath('app/api/bookings/route.ts', 1024)).toBe(true);
    expect(shouldIncludeCodeGraphPath('app/dashboard/page.tsx', 2048)).toBe(true);
    expect(shouldIncludeCodeGraphPath('db/schema.sql', 512)).toBe(true);
    expect(shouldIncludeCodeGraphPath('prisma/schema.prisma', 512)).toBe(true);
    expect(shouldIncludeCodeGraphPath('styles/app.css', 512)).toBe(true);
    expect(shouldIncludeCodeGraphPath('package.json', 512)).toBe(true);
  });

  it('skips secrets, binaries, lockfiles, generated files, build output, and oversized files', async () => {
    const { shouldIncludeCodeGraphPath } = await import('./code-graph.service');

    expect(shouldIncludeCodeGraphPath('.env', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('.env.production', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('private/server.key', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('public/logo.png', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('package-lock.json', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('node_modules/pkg/index.ts', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('dist/server.js', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('app/generated/client.ts', 10)).toBe(false);
    expect(shouldIncludeCodeGraphPath('app/api/large-route.ts', 501 * 1024)).toBe(false);
  });
});

describe('code graph redaction and cache identity', () => {
  it('redacts common secret-shaped values before saving reports', async () => {
    const { redactCodeGraphText } = await import('./code-graph.service');
    const redacted = redactCodeGraphText([
      'DATABASE_URL=postgres://user:pass@example.com/db',
      'STRIPE_SECRET_KEY=sk_test_abcdefghijklmnopqrstuvwxyz',
      'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456',
      'AWS=AKIAABCDEFGHIJKLMNOP',
      'Email founder@example.com',
      '-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----',
    ].join('\n'));

    expect(redacted).toContain('postgres://<REDACTED>');
    expect(redacted).toContain('<REDACTED_STRIPE_KEY>');
    expect(redacted).toContain('<REDACTED_GITHUB_TOKEN>');
    expect(redacted).toContain('<REDACTED_AWS_KEY>');
    expect(redacted).toContain('<REDACTED_EMAIL>');
    expect(redacted).toContain('<REDACTED_PRIVATE_KEY>');
    expect(redacted).not.toContain('user:pass');
    expect(redacted).not.toContain('founder@example.com');
  });

  it('keys cache by company, repo SHA, Graphify version, and graph config', async () => {
    const { codeGraphCacheKey } = await import('./code-graph.service');

    expect(codeGraphCacheKey('company-1', 'sha-a')).toHaveLength(24);
    expect(codeGraphCacheKey('company-1', 'sha-a')).toBe(codeGraphCacheKey('company-1', 'sha-a'));
    expect(codeGraphCacheKey('company-1', 'sha-a')).not.toBe(codeGraphCacheKey('company-1', 'sha-b'));
    expect(codeGraphCacheKey('company-1', 'sha-a')).not.toBe(codeGraphCacheKey('company-2', 'sha-a'));
    expect(codeGraphCacheKey('company-1', 'sha-a', '0.0.0')).not.toBe(codeGraphCacheKey('company-1', 'sha-a'));
  });
});

describe('code graph founder visibility', () => {
  it('keeps code graph docs internal-only', async () => {
    const { isFounderVisibleDocType } = await import('@/lib/founder-safety/hidden-doc-types');

    expect(isFounderVisibleDocType('code_graph_report')).toBe(false);
    expect(isFounderVisibleDocType('code_graph_manifest')).toBe(false);
    expect(isFounderVisibleDocType('product_overview')).toBe(true);
  });
});

describe('code graph cached query output', () => {
  it('returns repo-relative file paths instead of temp cache paths', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'code-graph-test-'));
    try {
      await mkdir(join(cacheDir, 'graphify-out'), { recursive: true });
      const absoluteRouteFile = join(cacheDir, 'repo', 'app', 'api', 'bookings', 'route.ts');
      await writeFile(join(cacheDir, 'graphify-out', 'graph.json'), JSON.stringify({
        nodes: [
          { id: 'route-post', label: 'POST()', source_file: absoluteRouteFile, file_type: 'typescript' },
        ],
        links: [],
      }), 'utf8');

      vi.mocked(documentService.getDocumentByType).mockResolvedValueOnce({
        content: JSON.stringify({
          schema_version: 1,
          company_id: 'company-1',
          github_repo: 'BALAJIapps/founder-app',
          repo_sha: 'abc123',
          default_branch: 'main',
          graphify_version: '0.7.16',
          graph_config_hash: 'hash',
          file_count: 1,
          accepted_bytes: 100,
          skipped_count: 0,
          built_at: '2026-05-13T00:00:00.000Z',
          cache_dir: cacheDir,
        }),
      } as never);

      const { queryCodeGraph } = await import('./code-graph.service');
      const result = await queryCodeGraph('company-1', 'Which API route creates bookings?');

      expect(result.answer).toContain('app/api/bookings/route.ts');
      expect(result.answer).not.toContain(cacheDir.replace(/\\/g, '/'));
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
