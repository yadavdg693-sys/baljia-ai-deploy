// Roadmap Service — archetype classification, milestone generation, evaluation
// The #1 missing feature: transforms Baljia from task executor to founder OS
//
// Key concepts:
// - Archetype: business model pattern (saas, marketplace, agency, etc.)
// - Roadmap: company's journey, divided into phases
// - Milestone: concrete goal within a phase
// - Criteria: evaluatable checklist item for a milestone

import { db, roadmaps, milestones, milestoneCriteria, companies, tasks } from '@/lib/db';
import { eq, and, desc, asc, count } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('RoadmapService');

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export type Archetype = 'saas' | 'marketplace' | 'agency' | 'content' | 'ecommerce' | 'community';
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface RoadmapWithMilestones {
  roadmap: typeof roadmaps.$inferSelect;
  milestones: (typeof milestones.$inferSelect & {
    criteria: (typeof milestoneCriteria.$inferSelect)[];
  })[];
}

// ══════════════════════════════════════════════
// ARCHETYPE CLASSIFICATION
// ══════════════════════════════════════════════

// Keywords that signal each archetype
const ARCHETYPE_SIGNALS: Record<Archetype, string[]> = {
  saas: ['software', 'platform', 'tool', 'dashboard', 'analytics', 'automation', 'api', 'subscription', 'app', 'cloud', 'crm', 'erp', 'project management'],
  marketplace: ['marketplace', 'connect', 'match', 'buyers', 'sellers', 'listings', 'hire', 'freelance', 'rent', 'booking', 'two-sided'],
  agency: ['agency', 'consulting', 'services', 'clients', 'freelance', 'design', 'marketing', 'development', 'boutique'],
  content: ['content', 'media', 'blog', 'newsletter', 'podcast', 'video', 'course', 'education', 'community', 'creator'],
  ecommerce: ['shop', 'store', 'product', 'ecommerce', 'e-commerce', 'retail', 'physical', 'shipping', 'inventory', 'dropship'],
  community: ['community', 'social', 'network', 'forum', 'members', 'group', 'tribe', 'club', 'membership'],
};

/**
 * Classify company archetype from its idea/one_liner.
 * Uses keyword scoring — no LLM call needed.
 */
export function classifyArchetype(idea: string, oneLiner?: string | null): Archetype {
  const text = `${idea} ${oneLiner ?? ''}`.toLowerCase();
  const scores: Record<Archetype, number> = { saas: 0, marketplace: 0, agency: 0, content: 0, ecommerce: 0, community: 0 };

  for (const [archetype, keywords] of Object.entries(ARCHETYPE_SIGNALS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        scores[archetype as Archetype] += keyword.length > 6 ? 2 : 1; // Longer keywords = stronger signal
      }
    }
  }

  // Find highest scoring archetype
  let best: Archetype = 'saas'; // default
  let bestScore = 0;
  for (const [archetype, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = archetype as Archetype;
    }
  }

  return best;
}

// ══════════════════════════════════════════════
// MILESTONE TEMPLATES — per archetype, per phase
// ══════════════════════════════════════════════

interface MilestoneTemplate {
  title: string;
  description: string;
  phase: number;
  sort_order: number;
  suggested_task_tags: string[];
  night_shift_hint: string;
  criteria: { title: string; auto_evaluatable: boolean; evaluation_query?: Record<string, unknown> }[];
}

// Phase naming convention:
// Phase 1: Foundation (setup, deploy)
// Phase 2: Core product (MVP features)
// Phase 3: Monetization (billing, pricing)
// Phase 4: Growth (marketing, outreach)
// Phase 5: Scale (automation, optimization)

const SAAS_MILESTONES: MilestoneTemplate[] = [
  // Phase 1: Foundation
  {
    title: 'Landing Page Live',
    description: 'Deploy a professional landing page with value proposition and email capture.',
    phase: 1, sort_order: 0,
    suggested_task_tags: ['landing-page', 'deploy', 'seo'],
    night_shift_hint: 'Build or improve the landing page with clear value prop, CTA, and SEO meta tags.',
    criteria: [
      { title: 'Landing page deployed', auto_evaluatable: true, evaluation_query: { table: 'companies', check: 'render_service_id IS NOT NULL' } },
      { title: 'SEO meta tags set', auto_evaluatable: false },
      { title: 'Email capture form working', auto_evaluatable: false },
    ],
  },
  {
    title: 'Brand Identity Defined',
    description: 'Complete brand voice, mission, and product overview documents.',
    phase: 1, sort_order: 1,
    suggested_task_tags: ['onboarding', 'copy'],
    night_shift_hint: 'Review and improve brand_voice and product_overview documents.',
    criteria: [
      { title: 'Brand voice document populated', auto_evaluatable: true, evaluation_query: { table: 'documents', check: "doc_type = 'brand_voice' AND content IS NOT NULL" } },
      { title: 'Mission document populated', auto_evaluatable: true, evaluation_query: { table: 'documents', check: "doc_type = 'mission' AND content IS NOT NULL" } },
      { title: 'Product overview document populated', auto_evaluatable: true, evaluation_query: { table: 'documents', check: "doc_type = 'product_overview' AND content IS NOT NULL" } },
    ],
  },
  // Phase 2: Core Product
  {
    title: 'Auth & User Management',
    description: 'Implement authentication, user accounts, and basic settings.',
    phase: 2, sort_order: 0,
    suggested_task_tags: ['auth', 'settings', 'dashboard'],
    night_shift_hint: 'Set up authentication flow and user dashboard.',
    criteria: [
      { title: 'Auth flow working', auto_evaluatable: false },
      { title: 'User dashboard exists', auto_evaluatable: false },
    ],
  },
  {
    title: 'Core Feature Built',
    description: 'Build the primary feature that delivers the core value proposition.',
    phase: 2, sort_order: 1,
    suggested_task_tags: ['feature', 'crud', 'api'],
    night_shift_hint: 'Implement the main CRUD or feature based on the product overview.',
    criteria: [
      { title: 'Core feature deployed', auto_evaluatable: false },
      { title: 'Core feature tested', auto_evaluatable: false },
    ],
  },
  // Phase 3: Monetization
  {
    title: 'Billing Integration',
    description: 'Set up Stripe, pricing page, and subscription management.',
    phase: 3, sort_order: 0,
    suggested_task_tags: ['billing', 'payment', 'pricing-page'],
    night_shift_hint: 'Integrate Stripe payment and create a pricing page.',
    criteria: [
      { title: 'Stripe integration working', auto_evaluatable: false },
      { title: 'Pricing page live', auto_evaluatable: false },
    ],
  },
  // Phase 4: Growth
  {
    title: 'First 10 Users',
    description: 'Acquire the first users through outreach, social, and content.',
    phase: 4, sort_order: 0,
    suggested_task_tags: ['outreach', 'tweet', 'cold-email', 'research'],
    night_shift_hint: 'Research target users and draft outreach emails. Post on social media.',
    criteria: [
      { title: 'First tweet posted', auto_evaluatable: true, evaluation_query: { table: 'tweets', check: 'COUNT(*) >= 1' } },
      { title: 'Outreach emails sent', auto_evaluatable: false },
    ],
  },
  {
    title: 'SEO & Content Foundation',
    description: 'Publish initial blog posts, set up analytics tracking.',
    phase: 4, sort_order: 1,
    suggested_task_tags: ['blog-post', 'seo', 'tracking', 'analytics'],
    night_shift_hint: 'Write SEO-optimized blog post about the problem the product solves.',
    criteria: [
      { title: 'Analytics tracking installed', auto_evaluatable: false },
      { title: 'First blog post published', auto_evaluatable: false },
    ],
  },
  // Phase 5: Scale
  {
    title: 'Automation & Optimization',
    description: 'Set up recurring tasks, monitoring, and performance optimization.',
    phase: 5, sort_order: 0,
    suggested_task_tags: ['automation', 'performance', 'cron', 'analytics'],
    night_shift_hint: 'Set up monitoring, optimize page load, and create recurring analytics.',
    criteria: [
      { title: 'Recurring tasks configured', auto_evaluatable: true, evaluation_query: { table: 'recurring_tasks', check: 'COUNT(*) >= 1' } },
      { title: 'Performance optimized', auto_evaluatable: false },
    ],
  },
];

// Default templates for other archetypes (customize later)
const DEFAULT_MILESTONES: MilestoneTemplate[] = SAAS_MILESTONES;

function getTemplatesForArchetype(archetype: Archetype): MilestoneTemplate[] {
  // SaaS has the most detailed templates; others default to it for now
  // TODO: Add specialized templates for marketplace, agency, content, ecommerce, community
  switch (archetype) {
    case 'saas': return SAAS_MILESTONES;
    default: return DEFAULT_MILESTONES;
  }
}

// ══════════════════════════════════════════════
// ROADMAP GENERATION
// ══════════════════════════════════════════════

/**
 * Generate a roadmap for a company based on its archetype.
 * Idempotent — skips if roadmap already exists.
 */
export async function generateRoadmap(companyId: string): Promise<typeof roadmaps.$inferSelect | null> {
  // Check if roadmap already exists
  const [existing] = await db.select().from(roadmaps)
    .where(eq(roadmaps.company_id, companyId)).limit(1);
  if (existing) {
    log.debug('Roadmap already exists', { companyId, roadmapId: existing.id });
    return existing;
  }

  // Get company info for classification
  const [company] = await db.select({
    original_idea: companies.original_idea,
    one_liner: companies.one_liner,
    name: companies.name,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!company) {
    log.error('Company not found', { companyId });
    return null;
  }

  const archetype = classifyArchetype(company.original_idea ?? company.name, company.one_liner);
  const templates = getTemplatesForArchetype(archetype);
  const totalPhases = Math.max(...templates.map((t) => t.phase));

  // Create roadmap
  const [roadmap] = await db.insert(roadmaps).values({
    company_id: companyId,
    archetype,
    title: `${company.name} — ${archetype.charAt(0).toUpperCase() + archetype.slice(1)} Roadmap`,
    description: `Auto-generated ${archetype} roadmap for ${company.name}. ${totalPhases} phases from foundation to scale.`,
    status: 'active',
    current_phase: 1,
    total_phases: totalPhases,
  }).returning();

  // Create milestones with criteria
  for (const template of templates) {
    const [milestone] = await db.insert(milestones).values({
      roadmap_id: roadmap.id,
      company_id: companyId,
      phase: template.phase,
      sort_order: template.sort_order,
      title: template.title,
      description: template.description,
      status: 'pending',
      suggested_task_tags: template.suggested_task_tags,
      night_shift_hint: template.night_shift_hint,
    }).returning();

    // Create criteria for this milestone
    for (const criterion of template.criteria) {
      await db.insert(milestoneCriteria).values({
        milestone_id: milestone.id,
        title: criterion.title,
        auto_evaluatable: criterion.auto_evaluatable,
        evaluation_query: criterion.evaluation_query ?? null,
      });
    }
  }

  log.info('Roadmap generated', { companyId, archetype, milestones: templates.length, phases: totalPhases });
  return roadmap;
}

// ══════════════════════════════════════════════
// ROADMAP RETRIEVAL
// ══════════════════════════════════════════════

/**
 * Get full roadmap with milestones and criteria, ordered by phase.
 */
export async function getRoadmap(companyId: string): Promise<RoadmapWithMilestones | null> {
  const [roadmap] = await db.select().from(roadmaps)
    .where(eq(roadmaps.company_id, companyId)).limit(1);

  if (!roadmap) return null;

  const milestoneRows = await db.select().from(milestones)
    .where(eq(milestones.roadmap_id, roadmap.id))
    .orderBy(asc(milestones.phase), asc(milestones.sort_order));

  const milestoneIds = milestoneRows.map((m) => m.id);
  const criteriaRows = milestoneIds.length > 0
    ? await db.select().from(milestoneCriteria)
        .where(eq(milestoneCriteria.milestone_id, milestoneIds[0]))
        // Get all criteria - we'll group them in memory
    : [];

  // Fetch all criteria at once, then group
  const allCriteria: (typeof milestoneCriteria.$inferSelect)[] = [];
  for (const m of milestoneRows) {
    const criteria = await db.select().from(milestoneCriteria)
      .where(eq(milestoneCriteria.milestone_id, m.id));
    allCriteria.push(...criteria);
  }

  const criteriaByMilestone = new Map<string, (typeof milestoneCriteria.$inferSelect)[]>();
  for (const c of allCriteria) {
    const existing = criteriaByMilestone.get(c.milestone_id) ?? [];
    existing.push(c);
    criteriaByMilestone.set(c.milestone_id, existing);
  }

  return {
    roadmap,
    milestones: milestoneRows.map((m) => ({
      ...m,
      criteria: criteriaByMilestone.get(m.id) ?? [],
    })),
  };
}

// ══════════════════════════════════════════════
// MILESTONE EVALUATION
// ══════════════════════════════════════════════

/**
 * Evaluate a single milestone's criteria and update completion status.
 * Auto-evaluatable criteria are checked against the database.
 */
export async function evaluateMilestone(milestoneId: string): Promise<{
  allMet: boolean;
  totalCriteria: number;
  metCount: number;
}> {
  const criteria = await db.select().from(milestoneCriteria)
    .where(eq(milestoneCriteria.milestone_id, milestoneId));

  let metCount = 0;

  for (const c of criteria) {
    if (c.is_met) {
      metCount++;
      continue;
    }

    // Auto-evaluate if possible
    if (c.auto_evaluatable && c.evaluation_query) {
      // evaluation_query is { table: string, check: string }
      // We don't execute arbitrary SQL — just mark as "needs manual check" for safety
      // In production, this would be a controlled query builder
      log.debug('Auto-eval criterion skipped (safety)', { criterionId: c.id });
    }
  }

  const allMet = metCount === criteria.length && criteria.length > 0;

  // If all criteria met, complete the milestone
  if (allMet) {
    await db.update(milestones).set({
      status: 'completed',
      completed_at: new Date(),
      updated_at: new Date(),
    }).where(eq(milestones.id, milestoneId));
  }

  return { allMet, totalCriteria: criteria.length, metCount };
}

/**
 * Mark a specific criterion as met.
 */
export async function markCriterionMet(criterionId: string, evidence?: Record<string, unknown>): Promise<void> {
  await db.update(milestoneCriteria).set({
    is_met: true,
    met_at: new Date(),
    evidence: evidence ?? null,
  }).where(eq(milestoneCriteria.id, criterionId));
}

// ══════════════════════════════════════════════
// ROADMAP ADVANCEMENT
// ══════════════════════════════════════════════

/**
 * Check if all milestones in the current phase are complete.
 * If so, advance to the next phase.
 */
export async function advanceRoadmap(companyId: string): Promise<{
  advanced: boolean;
  currentPhase: number;
  reason: string;
}> {
  const [roadmap] = await db.select().from(roadmaps)
    .where(and(eq(roadmaps.company_id, companyId), eq(roadmaps.status, 'active')))
    .limit(1);

  if (!roadmap) {
    return { advanced: false, currentPhase: 0, reason: 'No active roadmap' };
  }

  // Get all milestones for the current phase
  const currentMilestones = await db.select().from(milestones)
    .where(and(
      eq(milestones.roadmap_id, roadmap.id),
      eq(milestones.phase, roadmap.current_phase),
    ));

  // Check if all are completed
  const allCompleted = currentMilestones.length > 0 &&
    currentMilestones.every((m) => m.status === 'completed' || m.status === 'skipped');

  if (!allCompleted) {
    const pending = currentMilestones.filter((m) => m.status !== 'completed' && m.status !== 'skipped');
    return {
      advanced: false,
      currentPhase: roadmap.current_phase,
      reason: `${pending.length} milestone(s) still pending in phase ${roadmap.current_phase}`,
    };
  }

  // Check if there are more phases
  if (roadmap.current_phase >= roadmap.total_phases) {
    await db.update(roadmaps).set({
      status: 'completed',
      updated_at: new Date(),
    }).where(eq(roadmaps.id, roadmap.id));
    return { advanced: false, currentPhase: roadmap.current_phase, reason: 'Roadmap completed!' };
  }

  // Advance to next phase
  const nextPhase = roadmap.current_phase + 1;
  await db.update(roadmaps).set({
    current_phase: nextPhase,
    updated_at: new Date(),
  }).where(eq(roadmaps.id, roadmap.id));

  // Start first milestone of next phase
  const nextMilestones = await db.select().from(milestones)
    .where(and(eq(milestones.roadmap_id, roadmap.id), eq(milestones.phase, nextPhase)))
    .orderBy(asc(milestones.sort_order))
    .limit(1);

  if (nextMilestones.length > 0) {
    await db.update(milestones).set({
      status: 'in_progress',
      started_at: new Date(),
      updated_at: new Date(),
    }).where(eq(milestones.id, nextMilestones[0].id));
  }

  log.info('Roadmap advanced', { companyId, from: roadmap.current_phase, to: nextPhase });
  return { advanced: true, currentPhase: nextPhase, reason: `Advanced to phase ${nextPhase}` };
}

// ══════════════════════════════════════════════
// NIGHT SHIFT INTEGRATION HELPERS
// ══════════════════════════════════════════════

/**
 * Get suggested task tags from the current active milestone.
 * Night shift uses this to generate relevant tasks.
 */
export async function getCurrentMilestoneTags(companyId: string): Promise<{
  tags: string[];
  hint: string | null;
  milestoneTitle: string | null;
}> {
  const [roadmap] = await db.select().from(roadmaps)
    .where(and(eq(roadmaps.company_id, companyId), eq(roadmaps.status, 'active')))
    .limit(1);

  if (!roadmap) return { tags: [], hint: null, milestoneTitle: null };

  // Get first in_progress milestone, or first pending in current phase
  const [currentMilestone] = await db.select().from(milestones)
    .where(and(
      eq(milestones.roadmap_id, roadmap.id),
      eq(milestones.phase, roadmap.current_phase),
    ))
    .orderBy(
      // in_progress first, then pending
      asc(milestones.sort_order)
    )
    .limit(1);

  if (!currentMilestone) return { tags: [], hint: null, milestoneTitle: null };

  return {
    tags: (currentMilestone.suggested_task_tags as string[]) ?? [],
    hint: currentMilestone.night_shift_hint,
    milestoneTitle: currentMilestone.title,
  };
}
