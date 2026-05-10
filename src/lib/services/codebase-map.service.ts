// Codebase map — per-company technical map of the deployed app maintained
// by the engineering agent. Read at the start of extend tasks (so the agent
// doesn't go blind on what's already there), updated at the end of every
// successful task. Internal scaffolding — never shown on the founder dashboard.
//
// Backed by the existing `documents` table with `doc_type='codebase_map'`.
// Open-string doc_type means no migration; updateDocument bumps version.

import { z } from 'zod';
import { db, documents } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import * as documentService from './document.service';

export const CODEBASE_MAP_DOC_TYPE = 'codebase_map';

// Canonical structure the agent produces. Versioned so we can evolve the
// shape later without breaking older companies' maps.
export const codebaseMapSchema = z.object({
  schema_version: z.literal(1),
  stack: z.object({
    framework:    z.string(),
    runtime:      z.string(),
    database:     z.string(),
    hosting:      z.string(),
    integrations: z.array(z.string()).default([]),
  }),
  deploy: z.object({
    github_repo:        z.string().nullable(),
    render_service_id:  z.string().nullable(),
    app_url:            z.string().nullable(),
    last_commit_sha:    z.string().nullable(),
    last_deployed_at:   z.string().nullable(),
  }),
  schema: z.array(z.object({
    table:   z.string(),
    columns: z.array(z.string()),
    notes:   z.string().optional(),
  })).default([]),
  routes: z.array(z.object({
    path:   z.string(),
    method: z.string(),
    auth:   z.enum(['public', 'session', 'admin']),
    notes:  z.string().optional(),
  })).default([]),
  patterns: z.object({
    auth:           z.string(),
    query_layer:    z.string(),
    error_handling: z.string(),
  }),
  shipped_features: z.array(z.object({
    feature:    z.string(),
    task_id:    z.string().nullable(),
    shipped_at: z.string(),
  })).default([]),
  notes: z.string().nullable().default(null),
});

export type CodebaseMap = z.infer<typeof codebaseMapSchema>;

/**
 * Read the company's codebase map. Returns null when:
 *  - no codebase_map row exists,
 *  - row exists but content is empty,
 *  - row exists but content fails Zod parse (corrupted prior write).
 *
 * Never throws — engineering agent will treat null as "first build" and
 * proceed from skeleton.
 */
export async function getCodebaseMap(companyId: string): Promise<CodebaseMap | null> {
  const doc = await documentService.getDocumentByType(companyId, CODEBASE_MAP_DOC_TYPE);
  if (!doc || !doc.content || doc.content.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(doc.content);
    const validated = codebaseMapSchema.safeParse(parsed);
    if (!validated.success) return null;
    return validated.data;
  } catch {
    return null;
  }
}

/**
 * Upsert the company's codebase map. Validates shape before write so we
 * never persist a corrupted map. If the row exists, bumps version via
 * documentService.updateDocument; otherwise inserts a fresh row.
 */
export async function writeCodebaseMap(companyId: string, map: CodebaseMap): Promise<void> {
  const validated = codebaseMapSchema.parse(map); // throws on bad input
  const content = JSON.stringify(validated, null, 2);

  const existing = await documentService.getDocumentByType(companyId, CODEBASE_MAP_DOC_TYPE);
  if (existing) {
    await documentService.updateDocument(existing.id, content);
    return;
  }

  await db.insert(documents).values({
    company_id: companyId,
    doc_type:   CODEBASE_MAP_DOC_TYPE,
    title:      'Codebase Map (internal)',
    content,
    source:     'engineering_agent',
    version:    1,
    is_empty:   false,
  });
}

/**
 * Render the codebase map as compact markdown for system-prompt injection.
 * Target: ≤ 1500 tokens (~6 KB) for typical apps. Capped at large maps to
 * prevent context bloat.
 */
export function formatCodebaseMapForPrompt(map: CodebaseMap): string {
  const lines: string[] = [];
  lines.push('## Existing app (codebase map)');
  lines.push('');
  lines.push(`**Stack:** ${map.stack.framework} · ${map.stack.runtime} · ${map.stack.database} · ${map.stack.hosting}`);
  if (map.stack.integrations.length > 0) {
    lines.push(`**Integrations:** ${map.stack.integrations.join(', ')}`);
  }
  lines.push('');
  if (map.deploy.app_url) lines.push(`**Live at:** ${map.deploy.app_url}`);
  if (map.deploy.github_repo) lines.push(`**Repo:** ${map.deploy.github_repo}`);
  if (map.deploy.last_commit_sha) lines.push(`**Last commit:** ${map.deploy.last_commit_sha.slice(0, 12)}`);
  lines.push('');

  if (map.schema.length > 0) {
    lines.push('**Schema:**');
    const trimmedTables = map.schema.slice(0, 25);
    for (const t of trimmedTables) {
      const cols = t.columns.slice(0, 12).join(', ');
      lines.push(`- \`${t.table}\` (${cols}${t.columns.length > 12 ? ', …' : ''})${t.notes ? ` — ${t.notes}` : ''}`);
    }
    if (map.schema.length > 25) lines.push(`- … +${map.schema.length - 25} more tables`);
    lines.push('');
  }

  if (map.routes.length > 0) {
    lines.push('**Routes:**');
    const trimmedRoutes = map.routes.slice(0, 30);
    for (const r of trimmedRoutes) {
      lines.push(`- \`${r.method} ${r.path}\` (${r.auth})${r.notes ? ` — ${r.notes}` : ''}`);
    }
    if (map.routes.length > 30) lines.push(`- … +${map.routes.length - 30} more routes`);
    lines.push('');
  }

  lines.push('**Patterns:**');
  lines.push(`- auth: ${map.patterns.auth}`);
  lines.push(`- query layer: ${map.patterns.query_layer}`);
  lines.push(`- error handling: ${map.patterns.error_handling}`);
  lines.push('');

  if (map.shipped_features.length > 0) {
    lines.push('**Shipped so far:**');
    const recent = map.shipped_features.slice(-10);
    for (const f of recent) {
      lines.push(`- ${f.feature} (${f.shipped_at.slice(0, 10)})`);
    }
    lines.push('');
  }

  if (map.notes) {
    lines.push('**Notes:**');
    lines.push(map.notes);
  }

  return lines.join('\n').trim();
}
