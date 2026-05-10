// Codebase map service tests — get/write round-trip, graceful nulls,
// validation, and prompt-format size cap.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeRows: Array<{ id: string; company_id: string; doc_type: string; content: string }> = [];

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async (v: any) => {
        fakeRows.push({ id: `row-${fakeRows.length + 1}`, ...v });
      }),
    })),
  },
  documents: {},
}));

vi.mock('./document.service', () => ({
  getDocumentByType: vi.fn(async (companyId: string, docType: string) => {
    const found = fakeRows.find((r) => r.company_id === companyId && r.doc_type === docType);
    return found ? { ...found, is_empty: !found.content, version: 1 } : null;
  }),
  updateDocument: vi.fn(async (id: string, content: string) => {
    const r = fakeRows.find((x) => x.id === id);
    if (r) r.content = content;
    return r;
  }),
}));

const sampleMap = {
  schema_version: 1 as const,
  stack: { framework: 'Express 4', runtime: 'Node 20', database: 'Postgres (Neon)', hosting: 'Render', integrations: ['Stripe', 'Postmark'] },
  deploy: { github_repo: 'BALAJIapps/threadpulse', render_service_id: 'srv-x', app_url: 'https://threadpulse.baljia.app', last_commit_sha: 'abc123def456', last_deployed_at: '2026-05-10T12:00:00Z' },
  schema: [
    { table: 'users', columns: ['id', 'email', 'password_hash', 'created_at'] },
    { table: 'posts', columns: ['id', 'user_id', 'title', 'body', 'created_at'] },
  ],
  routes: [
    { path: '/auth/register', method: 'POST', auth: 'public' as const },
    { path: '/api/posts',     method: 'POST', auth: 'session' as const },
  ],
  patterns: { auth: 'session-based via connect-pg-simple', query_layer: 'pg pool', error_handling: 'ok/fail discriminated unions' },
  shipped_features: [{ feature: 'initial scaffold + auth', task_id: 't1', shipped_at: '2026-05-10T11:00:00Z' }],
  notes: null,
};

describe('codebase-map service', () => {
  beforeEach(() => {
    fakeRows.length = 0;
    vi.clearAllMocks();
  });

  it('getCodebaseMap returns null when no row exists', async () => {
    const { getCodebaseMap } = await import('./codebase-map.service');
    const result = await getCodebaseMap('co-empty');
    expect(result).toBeNull();
  });

  it('getCodebaseMap returns null when row exists but content is empty', async () => {
    fakeRows.push({ id: 'r1', company_id: 'co-1', doc_type: 'codebase_map', content: '' });
    const { getCodebaseMap } = await import('./codebase-map.service');
    const result = await getCodebaseMap('co-1');
    expect(result).toBeNull();
  });

  it('getCodebaseMap returns null when content is non-JSON (graceful)', async () => {
    fakeRows.push({ id: 'r2', company_id: 'co-2', doc_type: 'codebase_map', content: 'this is not json' });
    const { getCodebaseMap } = await import('./codebase-map.service');
    const result = await getCodebaseMap('co-2');
    expect(result).toBeNull();
  });

  it('writeCodebaseMap inserts a new row when none exists', async () => {
    const { writeCodebaseMap, getCodebaseMap, CODEBASE_MAP_DOC_TYPE } = await import('./codebase-map.service');
    await writeCodebaseMap('co-new', sampleMap);
    expect(fakeRows.length).toBe(1);
    expect(fakeRows[0].doc_type).toBe(CODEBASE_MAP_DOC_TYPE);
    const round = await getCodebaseMap('co-new');
    expect(round?.stack.framework).toBe('Express 4');
    expect(round?.shipped_features).toHaveLength(1);
  });

  it('writeCodebaseMap updates existing row (idempotent on company)', async () => {
    const { writeCodebaseMap, getCodebaseMap } = await import('./codebase-map.service');
    await writeCodebaseMap('co-up', sampleMap);
    const updated = { ...sampleMap, shipped_features: [...sampleMap.shipped_features, { feature: 'leaderboard', task_id: 't2', shipped_at: '2026-05-10T13:00:00Z' }] };
    await writeCodebaseMap('co-up', updated);
    expect(fakeRows.length).toBe(1); // updated, not duplicated
    const round = await getCodebaseMap('co-up');
    expect(round?.shipped_features).toHaveLength(2);
  });

  it('writeCodebaseMap rejects malformed input via Zod', async () => {
    const { writeCodebaseMap } = await import('./codebase-map.service');
    const bad = { ...sampleMap, schema_version: 99 } as never;
    await expect(writeCodebaseMap('co-bad', bad)).rejects.toThrow();
  });

  it('formatCodebaseMapForPrompt produces compact markdown under 1500 tokens (~6KB) for typical apps', async () => {
    const { formatCodebaseMapForPrompt } = await import('./codebase-map.service');
    const out = formatCodebaseMapForPrompt(sampleMap);
    expect(out).toMatch(/^## Existing app/);
    expect(out).toContain('Express 4');
    expect(out).toContain('threadpulse.baljia.app');
    expect(out).toContain('users');
    expect(out).toContain('/api/posts');
    expect(out.length).toBeLessThan(6000); // ~1500 token budget
  });
});
