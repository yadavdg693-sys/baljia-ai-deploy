// Memory Service — migrated to Drizzle + Neon
import { db, memoryLayers, learnings, tasks } from '@/lib/db';
import { eq, and, desc, ilike, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { MemoryLayerNumber, MemoryLayer, Learning, LearningConfidence } from '@/types';

const log = createLogger('Memory');

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

  if (task.status === 'completed_verified' && task.turn_count < 5) {
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

  if (task.actual_credits_charged <= 1 && task.status === 'completed_verified') {
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
        tags: JSON.stringify(l.tags),
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
    status: task.status ?? 'created',
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
  // Use ilike on tags JSON string to find tag matches
  const data = await db.select().from(learnings)
    .where(and(
      eq(learnings.company_id, companyId),
      ilike(learnings.tags, `%${tag}%`)
    ))
    .orderBy(desc(learnings.confidence))
    .limit(limit);

  return data as unknown as unknown as Learning[];
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

  return data as unknown as unknown as Learning[];
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
    const capped = layer1.content.length > 10_000
      ? layer1.content.substring(0, 10_000) + '\n... [truncated to fit context]'
      : layer1.content;
    sections.push(`### Domain Knowledge\n${capped}`);
  }

  // Layer 2: Founder Preferences
  const [layer2] = await db.select({ content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, 2)))
    .limit(1);

  if (layer2?.content?.trim()) {
    const capped = layer2.content.length > 2_000
      ? layer2.content.substring(0, 2_000) + '\n... [truncated]'
      : layer2.content;
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
        .limit(5) as unknown as unknown as Learning[];
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
  const [existing] = await db.select({ id: memoryLayers.id, content: memoryLayers.content })
    .from(memoryLayers)
    .where(and(eq(memoryLayers.company_id, companyId), eq(memoryLayers.layer, layer)))
    .limit(1);

  if (existing) {
    let finalContent = content;
    if (layer === 1 && content.startsWith('## ') && existing.content) {
      finalContent = mergeMemorySection(existing.content as string, content);
    }
    await db.update(memoryLayers)
      .set({ content: finalContent, updated_at: new Date() })
      .where(eq(memoryLayers.id, existing.id));
  } else {
    await db.insert(memoryLayers).values({
      company_id: companyId,
      layer,
      content,
      max_tokens: layer === 2 ? 3000 : 15000,
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
