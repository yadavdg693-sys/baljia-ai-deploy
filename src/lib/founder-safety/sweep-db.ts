// DB sweep — for a given company_id, scan every founder-visible column for
// banned terms and return violations. Meant to be run manually against a
// staging DB after a smoke-test onboarding, or wired into an integration
// test that runs a company through onboarding + asserts no violations.
//
// Scanned columns (founder-visible only; internal columns like payload
// metadata or system-only logs are ignored):
//   - tasks.title, tasks.description, tasks.suggestion_reasoning
//   - documents.content, documents.title
//   - memory_layers.content          (layer 1 especially — fed to CEO)
//   - platform_events.payload->>'text'  (the activity stream)
//   - chat_sessions.messages (roll-up)
//   - email_threads.body
//
// Usage:
//   const violations = await sweepCompanyForContamination(companyId);
//   if (violations.length) throw new Error(`leaks in ${violations.length} rows`);

import { db, tasks, documents, memoryLayers, platformEvents, chatSessions, emailThreads } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { sanitizeForFounder } from './sanitize';

export interface DbViolation {
  table: string;
  rowId: string;
  column: string;
  excerpt: string;
  labels: string[];
}

export async function sweepCompanyForContamination(companyId: string): Promise<DbViolation[]> {
  const violations: DbViolation[] = [];

  const push = (table: string, rowId: string, column: string, text: string | null | undefined) => {
    if (!text) return;
    const r = sanitizeForFounder(String(text), { mode: 'soft' });
    if (r.hadViolations) {
      violations.push({
        table,
        rowId,
        column,
        excerpt: String(text).slice(0, 200),
        labels: r.violations.map((v) => v.label),
      });
    }
  };

  // tasks
  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      suggestion_reasoning: tasks.suggestion_reasoning,
    })
    .from(tasks)
    .where(eq(tasks.company_id, companyId));
  for (const t of taskRows) {
    push('tasks', t.id, 'title', t.title);
    push('tasks', t.id, 'description', t.description);
    push('tasks', t.id, 'suggestion_reasoning', t.suggestion_reasoning);
  }

  // documents
  const docRows = await db
    .select({ id: documents.id, title: documents.title, content: documents.content })
    .from(documents)
    .where(eq(documents.company_id, companyId));
  for (const d of docRows) {
    push('documents', d.id, 'title', d.title);
    push('documents', d.id, 'content', d.content);
  }

  // memory_layers
  const mlRows = await db
    .select({ id: memoryLayers.id, content: memoryLayers.content })
    .from(memoryLayers)
    .where(eq(memoryLayers.company_id, companyId));
  for (const m of mlRows) {
    push('memory_layers', m.id, 'content', m.content);
  }

  // platform_events — activity stream text
  const evRows = await db
    .select({ id: platformEvents.id, payload: platformEvents.payload })
    .from(platformEvents)
    .where(eq(platformEvents.company_id, companyId));
  for (const e of evRows) {
    const text = (e.payload as Record<string, unknown> | null)?.text;
    if (typeof text === 'string') {
      push('platform_events', e.id, 'payload.text', text);
    }
  }

  // chat_sessions — messages array
  const chatRows = await db
    .select({ id: chatSessions.id, messages: chatSessions.messages })
    .from(chatSessions)
    .where(eq(chatSessions.company_id, companyId));
  for (const c of chatRows) {
    const msgs = (c.messages as Array<{ content?: string }> | null) ?? [];
    for (let i = 0; i < msgs.length; i++) {
      push('chat_sessions', c.id, `messages[${i}].content`, msgs[i]?.content);
    }
  }

  // email_threads
  const emailRows = await db
    .select({ id: emailThreads.id, subject: emailThreads.subject, body: emailThreads.body })
    .from(emailThreads)
    .where(eq(emailThreads.company_id, companyId));
  for (const em of emailRows) {
    push('email_threads', em.id, 'subject', em.subject);
    push('email_threads', em.id, 'body', em.body);
  }

  return violations;
}

export function formatViolationReport(violations: DbViolation[]): string {
  if (violations.length === 0) return '✅ No contamination found.';
  const lines = [`❌ ${violations.length} contaminated row(s):\n`];
  for (const v of violations) {
    lines.push(`  ${v.table}.${v.column} [${v.rowId.slice(0, 8)}...] — ${v.labels.join(', ')}`);
    lines.push(`    "${v.excerpt.replace(/\n/g, ' ')}"`);
  }
  return lines.join('\n');
}
