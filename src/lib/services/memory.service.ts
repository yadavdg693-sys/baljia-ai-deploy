// Memory Service — migrated to Drizzle + Neon
import { db, memoryLayers, learnings, tasks, companies, reports, failureFingerprints } from '@/lib/db';
import { eq, and, desc, ilike, sql, gte } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { MemoryLayerNumber, MemoryLayer, Learning, LearningConfidence, ContextPacket, CompanyStage, Lifecycle, BillingState } from '@/types';

const log = createLogger('Memory');

// ══════════════════════════════════════════════
// TOKEN BUDGET ENFORCEMENT (SPEC-CTRL-105)
// Layer 1 (Domain Knowledge): 15,000 tokens
// Layer 2 (User Preferences): 3,000 tokens
// Layer 3 (Cross-Company): 15,000 tokens
// Approx: 1 token ≈ 4 characters (conservative estimate)
// ══════════════════════════════════════════════

const CHARS_PER_TOKEN = 4;

const TOKEN_BUDGETS: Record<number, number> = {
  1: 15_000,
  2: 3_000,
  3: 15_000,
};

/** Estimate token count from string content (4 chars per token approximation) */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

/**
 * Evict content to fit within token budget.
 * - L2 (3K): Keeps most recent content, trims from the beginning
 * - L1/L3 (15K): Keeps most recent sections (## headers), drops oldest first
 */
function evictToFit(content: string, maxTokens: number, layer: number): string {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) return content;

  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (layer === 2) {
    // L2: Small budget — keep the tail (most recent preferences)
    return content.slice(-maxChars);
  }

  // L1/L3: Split by ## sections, drop oldest (earliest in text) first
  const sections = content.split(/(?=^## )/m);
  if (sections.length <= 1) {
    // No sections — just truncate from the start
    return content.slice(-maxChars);
  }

  // Keep sections from the end until we exceed budget
  const kept: string[] = [];
  let totalChars = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (totalChars + sections[i].length > maxChars && kept.length > 0) break;
    kept.unshift(sections[i]);
    totalChars += sections[i].length;
  }

  return kept.join('');
}

// ══════════════════════════════════════════════
// LEARNING EXTRACTION — after task completion
// ══════════════════════════════════════════════

interface ExtractionResult {
  learnings: Array<{
    category: string;
    content: string;
    confidence: LearningConfidence;
    tags: string[];
  }>;
}

// Deterministic extraction rules (no LLM needed)
function extractLearnings(task: {
  title: string;
  tag: string;
  description: string | null;
  failure_class: string | null;
  status: string;
  turn_count: number;
  actual_credits_charged: number;
}): ExtractionResult {
  const results: ExtractionResult['learnings'] = [];

  if (task.status === 'completed' && task.turn_count < 5) {
    results.push({
      category: 'efficiency',
      content: `Task "${task.title}" completed in ${task.turn_count} turns. Tag: ${task.tag}. This is an efficient execution pattern.`,
      confidence: 'high',
      tags: [task.tag, 'efficient'],
    });
  }

  if (task.status === 'failed' && task.failure_class) {
    results.push({
      category: 'failure_pattern',
      content: `Task "${task.title}" (tag: ${task.tag}) failed with class: ${task.failure_class}. Avoid this pattern in future similar tasks.`,
      confidence: 'medium',
      tags: [task.tag, 'failure', 'avoid'],
    });
  }

  if (task.turn_count > 100) {
    results.push({
      category: 'complexity',
      content: `Task "${task.title}" required ${task.turn_count} turns. Tag: ${task.tag}. Consider splitting similar tasks.`,
      confidence: 'medium',
      tags: [task.tag, 'complex', 'split_candidate'],
    });
  }

  if (task.actual_credits_charged <= 1 && task.status === 'completed') {
    results.push({
      category: 'cost_efficiency',
      content: `Task "${task.title}" completed within 1 credit. Tag: ${task.tag}.`,
      confidence: 'high',
      tags: [task.tag, 'cost_effective'],
    });
  }

  return { learnings: results };
}

// ══════════════════════════════════════════════
// STORE
// ══════════════════════════════════════════════

export async function storeLearnings(
  companyId: string,
  taskId: string,
  extracted: ExtractionResult
): Promise<number> {
  let stored = 0;
  for (const l of extracted.learnings) {
    try {
      await db.insert(learnings).values({
        company_id: companyId,
        task_id: taskId,
        category: l.category,
        content: l.content,
        confidence: l.confidence,
        tags: l.tags,
      });
      stored++;
    } catch { /* skip duplicates */ }
  }
  return stored;
}

// ══════════════════════════════════════════════
// PROCESS — extract + store after task completion
// ══════════════════════════════════════════════

export async function processTaskLearnings(taskId: string): Promise<number> {
  const [task] = await db.select({
    id: tasks.id,
    company_id: tasks.company_id,
    title: tasks.title,
    tag: tasks.tag,
    description: tasks.description,
    failure_class: tasks.failure_class,
    status: tasks.status,
    turn_count: tasks.turn_count,
    actual_credits_charged: tasks.actual_credits_charged,
  }).from(tasks).where(eq(tasks.id, taskId)).limit(1);

  if (!task) return 0;

  const extracted = extractLearnings({
    title: task.title,
    tag: task.tag,
    description: task.description,
    failure_class: task.failure_class,
    status: task.status ?? 'todo',
    turn_count: task.turn_count ?? 0,
    actual_credits_charged: task.actual_credits_charged ?? 0,
  });

  if (extracted.learnings.length === 0) return 0;

  const stored = await storeLearnings(task.company_id, taskId, extracted);
  log.info('Learnings extracted', { taskId, stored });
  return stored;
}

// ══════════════════════════════════════════════
// QUERY
// ══════════════════════════════════════════════

export async function getRelevantLearnings(
  companyId: string,
  tag: string,
  limit = 5
): Promise<Learning[]> {
  // Only return active learnings
  const data = await db.select().from(learnings)
    .where(and(
      eq(learnings.company_id, companyId),
      sql`${learnings.tags}::text ILIKE ${'%' + tag + '%'}`,
      eq(learnings.status, 'active')
    ))
    .orderBy(desc(learnings.confidence))
    .limit(limit);

  // SPEC-CTRL-105: Increment usage_count for referenced learnings
  const ids = data.map(l => l.id);
  if (ids.length > 0) {
    try {
      for (const id of ids) {
        await incrementUsageCount(id);
      }
    } catch { /* non-blocking */ }
  }

  return data as unknown as Learning[];
}

export async function getCompanyLearnings(
  companyId: string,
  category?: string,
  limit = 20
): Promise<Learning[]> {
  const conditions = [eq(learnings.company_id, companyId)];
  if (category) conditions.push(eq(learnings.category, category));

  const data = await db.select().from(learnings)
    .where(and(...conditions))
    .orderBy(desc(learnings.created_at))
    .limit(limit);

  return data as unknown as Learning[];
}

// ══════════════════════════════════════════════
// LEARNINGS CRUD (SPEC-CTRL-105)
// Full create/read/update/delete + usage tracking
// ══════════════════════════════════════════════

/** Update a learning's content, tags, or status */
export async function updateLearning(
  learningId: string,
  fields: Partial<{ content: string; tags: string[]; status: string; confidence: string }>
): Promise<void> {
  const updateData: Record<string, unknown> = {};
  if (fields.content !== undefined) updateData.content = fields.content;
  if (fields.tags !== undefined) updateData.tags = fields.tags;
  if (fields.status !== undefined) updateData.status = fields.status;
  if (fields.confidence !== undefined) updateData.confidence = fields.confidence;

  if (Object.keys(updateData).length === 0) return;

  await db.update(learnings)
    .set(updateData)
    .where(eq(learnings.id, learningId));
}

/** Soft-delete a learning by setting status to archived */
export async function deleteLearning(learningId: string): Promise<void> {
  await db.update(learnings)
    .set({ status: 'archived' })
    .where(eq(learnings.id, learningId));
}

/** Increment usage_count and update last_referenced_at */
export async function incrementUsageCount(learningId: string): Promise<void> {
  await db.update(learnings)
    .set({
      usage_count: sql`COALESCE(${learnings.usage_count}, 0) + 1`,
      last_referenced_at: new Date(),
    })
    .where(eq(learnings.id, learningId));
}

/** Get a single learning by ID */
export async function getLearning(learningId: string): Promise<Learning | null> {
  const [data] = await db.select().from(learnings)
    .where(eq(learnings.id, learningId))
    .limit(1);
  return (data as unknown as Learning) ?? null;
}

// ══════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════

export async function getMemoryStats(companyId: string): Promise<{
  total_learnings: number;
  by_category: Record<string, number>;
  by_confidence: Record<string, number>;
}> {
  const data = await db.select({
    category: learnings.category,
    confidence: learnings.confidence,
  }).from(learnings).where(eq(learnings.company_id, companyId));

  if (!data.length) {
    return { total_learnings: 0, by_category: {}, by_confidence: {} };
  }

  const by_category: Record<string, number> = {};
  const by_confidence: Record<string, number> = {};
  for (const l of data) {
    const cat = l.category ?? 'unknown';
    const conf = l.confidence ?? 'medium';
    by_category[cat] = (by_category[cat] ?? 0) + 1;
    by_confidence[conf] = (by_confidence[conf] ?? 0) + 1;
  }

  return { total_learnings: data.length, by_category, by_confidence };
}

// ══════════════════════════════════════════════
// WORKER PACKET — full context injection for agent briefing
// ══════════════════════════════════════════════

export async function assembleWorkerPacket(
  companyId: string,
  task?: { title: string; tag: string; description?: string | null }
): Promise<string> {
  const sections: string[] = [];

  // Layer 1: Domain Knowledge
  const [layer1] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 1)))
    .limit(1);

  if (layer1?.content?.trim()) {
    const capped = evictToFit(layer1.content, TOKEN_BUDGETS[1], 1);
    sections.push(`### Domain Knowledge\n${capped}`);
  }

  // Layer 2: Founder Preferences
  const [layer2] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 2)))
    .limit(1);

  if (layer2?.content?.trim()) {
    const capped = evictToFit(layer2.content, TOKEN_BUDGETS[2], 2);
    sections.push(`### Founder Preferences\n${capped}`);
  }

  // Task-relevant learnings
  if (task) {
    const tagLearnings = await getRelevantLearnings(companyId, task.tag, 5);

    const keywords = task.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    let keywordLearnings: Learning[] = [];
    if (keywords.length > 0) {
      keywordLearnings = await db.select().from(learnings)
        .where(and(
          eq(learnings.company_id, companyId),
          ilike(learnings.content, `%${keywords[0]}%`)
        ))
        .orderBy(desc(learnings.created_at))
        .limit(5) as unknown as Learning[];
    }

    const seenContent = new Set<string>();
    const merged: Learning[] = [];
    for (const l of [...tagLearnings, ...keywordLearnings]) {
      if (!seenContent.has(l.content)) {
        seenContent.add(l.content);
        merged.push(l);
      }
      if (merged.length >= 8) break;
    }

    if (merged.length > 0) {
      const lines = merged.map((l) => `- [${l.category}] ${l.content}`);
      sections.push(`### Relevant lessons for this task\n${lines.join('\n')}`);
    }
  }

  // Recent high-confidence learnings
  const highConf = await db.select({
    category: learnings.category,
    content: learnings.content,
  }).from(learnings)
    .where(and(
      eq(learnings.company_id, companyId),
      eq(learnings.confidence, 'high')
    ))
    .orderBy(desc(learnings.created_at))
    .limit(7);

  if (highConf.length) {
    const lines = highConf.map((l) => `- [${l.category}] ${l.content}`);
    sections.push(`### Recent high-confidence learnings\n${lines.join('\n')}`);
  }

  // L3 cross-company patterns: intentionally NOT read here.
  // L3 has no write path in the current platform — no agent or service writes
  // to layer=3, and the schema is per-company so it can't be cross-company in
  // any meaningful sense (Finding B6 in POLSIA_BALJIA_COMPARISON.md). Reading
  // dead structure into the briefing implied a capability that doesn't exist
  // and consumed assembly time. Re-add this block once a real platform-wide
  // L3 store exists with quality-gated, anonymized writes.

  return sections.length === 0 ? '' : sections.join('\n\n');
}

// ══════════════════════════════════════════════
// SEARCH — keyword-based learning retrieval
// ══════════════════════════════════════════════

export async function searchLearnings(
  companyId: string,
  query: string,
  limit = 5
): Promise<Learning[]> {
  return db.select().from(learnings)
    .where(and(
      eq(learnings.company_id, companyId),
      ilike(learnings.content, `%${query}%`)
    ))
    .orderBy(desc(learnings.confidence))
    .limit(limit) as unknown as Promise<Learning[]>;
}

// ══════════════════════════════════════════════
// MEMORY LAYERS
// ══════════════════════════════════════════════

export async function getMemoryLayer(
  companyId: string,
  layer: MemoryLayerNumber
): Promise<MemoryLayer | null> {
  const [data] = await db.select().from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, layer)))
    .limit(1);

  return (data as unknown as MemoryLayer) ?? null;
}

export async function updateMemoryLayer(
  companyId: string,
  layer: MemoryLayerNumber,
  content: string
): Promise<void> {
  const maxTokens = TOKEN_BUDGETS[layer] ?? 15_000;

  const [existing] = await db.select({ id: memoryLayers.id, content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, layer)))
    .limit(1);

  if (existing) {
    let finalContent = content;
    if (layer === 1 && content.startsWith('## ') && existing.content) {
      finalContent = mergeMemorySection(existing.content as string, content);
    }

    // Token budget enforcement: evict if over budget
    finalContent = evictToFit(finalContent, maxTokens, layer);
    const tokenCount = estimateTokens(finalContent);

    await db.update(memoryLayers)
      .set({ content: finalContent, token_count: tokenCount, updated_at: new Date() })
      .where(eq(memoryLayers.id, existing.id));

    if (tokenCount >= maxTokens * 0.9) {
      log.info('Memory layer near budget', { companyId, layer, tokenCount, maxTokens });
    }
  } else {
    // New layer — evict if initial content exceeds budget
    const finalContent = evictToFit(content, maxTokens, layer);
    const tokenCount = estimateTokens(finalContent);

    await db.insert(memoryLayers).values({
      company_id: companyId,
      layer,
      content: finalContent,
      max_tokens: maxTokens,
      token_count: tokenCount,
    });
  }
}

function mergeMemorySection(existing: string, newSection: string): string {
  const headerMatch = newSection.match(/^(## [^\n]+)/);
  if (!headerMatch) return `${existing}\n\n${newSection}`;

  const header = headerMatch[1];
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |$)`, 'g');

  return regex.test(existing)
    ? existing.replace(regex, newSection)
    : `${existing}\n\n${newSection}`;
}

export async function getMemoryLayers(companyId: string): Promise<MemoryLayer[]> {
  return db.select().from(memoryLayers)
    .where(eq(memoryLayers.company_id, companyId)) as unknown as Promise<MemoryLayer[]>;
}

// ══════════════════════════════════════════════
// CONTEXT PACKET — typed execution context (SPEC-CTRL-105)
// Returns structured ContextPacket instead of raw string.
// Used by worker-launcher to provide typed context to executors.
// ══════════════════════════════════════════════

export async function buildContextPacket(
  companyId: string,
  task: { id: string; title: string; tag: string; description?: string | null },
): Promise<ContextPacket> {
  // 1. Memory layers
  const layers = await db.select({ layer: memoryLayers.layer, content: memoryLayers.content })
    .from(memoryLayers)
    .where(eq(memoryLayers.company_id, companyId));

  const layerMap: Record<number, string> = {};
  for (const l of layers) {
    layerMap[l.layer] = (l.content as string) ?? '';
  }

  // 2. Prior reports (last 3)
  const priorReports = await db.select({
    id: reports.id,
    title: reports.title,
    content: reports.content,
    task_id: reports.task_id,
  }).from(reports)
    .where(eq(reports.company_id, companyId))
    .orderBy(desc(reports.created_at))
    .limit(3);

  // 3. Recent failure fingerprints (last 7 days)
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000);
  let fingerprints: Array<{ fingerprint: string; category: string; description: string }> = [];
  try {
    const fpData = await db.select({
      fingerprint: failureFingerprints.fingerprint,
      category: failureFingerprints.category,
      description: failureFingerprints.description,
    }).from(failureFingerprints)
      .where(gte(failureFingerprints.last_seen_at, since7d))
      .limit(10);
    fingerprints = fpData.map(f => ({
      fingerprint: f.fingerprint ?? '',
      category: f.category ?? '',
      description: f.description ?? '',
    }));
  } catch { /* non-blocking */ }

  // 4. Company state
  const [company] = await db.select({
    company_stage: companies.company_stage,
    lifecycle: companies.lifecycle,
    billing_state: companies.billing_state,
  }).from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  // 5. Compile briefing string from memory layers.
  // L3 is intentionally not appended — see Finding B6: no write path exists
  // and the schema is per-company. Returning the (empty) field on the typed
  // contract is fine; injecting an empty section header isn't.
  const briefingSections: string[] = [];
  if (layerMap[1]?.trim()) briefingSections.push(`### Domain Knowledge\n${evictToFit(layerMap[1], TOKEN_BUDGETS[1], 1)}`);
  if (layerMap[2]?.trim()) briefingSections.push(`### Founder Preferences\n${evictToFit(layerMap[2], TOKEN_BUDGETS[2], 2)}`);
  const compiledBriefing = briefingSections.join('\n\n');

  return {
    memory_layers: {
      l1_domain_knowledge: layerMap[1] ?? '',
      l2_user_preferences: layerMap[2] ?? '',
      l3_cross_company: layerMap[3] ?? '',
    },
    prior_reports: priorReports.map(r => ({
      id: r.id,
      title: r.title ?? 'Untitled',
      content: (r.content ?? '').substring(0, 500),
      task_id: r.task_id ?? '',
    })),
    failure_fingerprints: fingerprints,
    company_state: {
      stage: (company?.company_stage as CompanyStage) ?? 'early',
      lifecycle: (company?.lifecycle as Lifecycle) ?? 'trial_active',
      billing_state: (company?.billing_state as BillingState) ?? 'trial',
    },
    compiled_briefing: compiledBriefing,
  };
}
