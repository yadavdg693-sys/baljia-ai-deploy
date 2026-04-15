// Company Stage Progression — migrated to Drizzle + Neon
import { db, companies, tasks, creditLedger, adCampaigns, emailThreads } from '@/lib/db';
import { eq, and, inArray, sql } from 'drizzle-orm';
import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';
import type { CompanyStage } from '@/types';

const log = createLogger('Stage');

interface StageDefinition {
  stage: CompanyStage;
  label: string;
  description: string;
  criteria: string[];
  nightShiftFocus: string;
  color: string;
}

const STAGES: StageDefinition[] = [
  { stage: 'early', label: 'Early', description: 'Building the foundation', criteria: ['Company created', 'Onboarding complete', 'First tasks running'], nightShiftFocus: 'What is obviously missing?', color: '#6366f1' },
  { stage: 'validation', label: 'Validation', description: 'Testing product-market fit', criteria: ['Website deployed', 'First paying customer or lead captured', '5+ tasks completed'], nightShiftFocus: 'What blocks activation?', color: '#8b5cf6' },
  { stage: 'monetization', label: 'Monetization', description: 'Converting users to revenue', criteria: ['Payment system live', 'Active marketing channel', '15+ tasks completed'], nightShiftFocus: 'What blocks conversion?', color: '#f59e0b' },
  { stage: 'retention', label: 'Retention', description: 'Keeping customers engaged', criteria: ['Recurring revenue', 'Customer communication active', '30+ tasks completed'], nightShiftFocus: 'What is underused or churn-inducing?', color: '#22c55e' },
  { stage: 'scale', label: 'Scale', description: 'Growing channels and reach', criteria: ['Multiple marketing channels', 'Stable revenue', '50+ tasks completed'], nightShiftFocus: 'What channel is underperforming?', color: '#f97316' },
  { stage: 'compounding', label: 'Compounding', description: 'Automating and defending', criteria: ['Growth sustained', 'Automation in place', '100+ tasks completed'], nightShiftFocus: 'What can be automated or defended?', color: '#ef4444' },
];

export async function evaluateStage(companyId: string): Promise<{
  currentStage: CompanyStage;
  suggestedStage: CompanyStage;
  shouldUpgrade: boolean;
  evidence: Record<string, unknown>;
}> {
  const [companyRow, completedTasks, paymentsRow, adsRow, emailsRow] = await Promise.all([
    db.select({ company_stage: companies.company_stage, onboarding_status: companies.onboarding_status, render_service_id: companies.render_service_id, subdomain: companies.subdomain })
      .from(companies).where(eq(companies.id, companyId)).limit(1),
    db.select({ count: sql<number>`count(*)` }).from(tasks)
      .where(and(eq(tasks.company_id, companyId), eq(tasks.status, 'completed'))),
    db.select({ count: sql<number>`count(*)` }).from(creditLedger)
      .where(and(eq(creditLedger.company_id, companyId), eq(creditLedger.entry_type, 'addon_purchase'))),
    db.select({ count: sql<number>`count(*)` }).from(adCampaigns)
      .where(eq(adCampaigns.company_id, companyId)),
    db.select({ count: sql<number>`count(*)` }).from(emailThreads)
      .where(and(eq(emailThreads.company_id, companyId), eq(emailThreads.direction, 'outbound'))),
  ]);

  const company = companyRow[0];
  const currentStage = (company?.company_stage ?? 'early') as CompanyStage;
  const completedCount = completedTasks[0]?.count ?? 0;
  const hasWebsite = !!company?.render_service_id || !!company?.subdomain;
  const hasPaid = (paymentsRow[0]?.count ?? 0) > 0;
  const hasAds = (adsRow[0]?.count ?? 0) > 0;
  const hasOutreach = (emailsRow[0]?.count ?? 0) > 0;
  const hasMarketingChannel = hasAds || hasOutreach;

  const evidence = { completed_tasks: completedCount, has_website: hasWebsite, has_paid: hasPaid, has_marketing: hasMarketingChannel, has_outreach: hasOutreach, onboarding: company?.onboarding_status };

  let suggestedStage: CompanyStage = 'early';
  if (completedCount >= 100 && hasMarketingChannel && hasPaid) suggestedStage = 'compounding';
  else if (completedCount >= 50 && hasMarketingChannel && hasPaid) suggestedStage = 'scale';
  else if (completedCount >= 30 && hasPaid) suggestedStage = 'retention';
  else if (completedCount >= 15 && hasMarketingChannel) suggestedStage = 'monetization';
  else if (completedCount >= 5 && hasWebsite) suggestedStage = 'validation';

  const stageOrder: CompanyStage[] = ['early', 'validation', 'monetization', 'retention', 'scale', 'compounding'];
  const shouldUpgrade = stageOrder.indexOf(suggestedStage) > stageOrder.indexOf(currentStage);

  return { currentStage, suggestedStage: shouldUpgrade ? suggestedStage : currentStage, shouldUpgrade, evidence };
}

export async function upgradeStage(companyId: string, newStage: CompanyStage): Promise<void> {
  const [company] = await db.select({ company_stage: companies.company_stage })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  const oldStage = company?.company_stage ?? 'early';

  await db.update(companies).set({ company_stage: newStage }).where(eq(companies.id, companyId));

  await eventService.emit(companyId, 'task_completed', { type: 'stage_upgrade', from: oldStage, to: newStage });
  log.info('Company stage upgraded', { companyId, from: oldStage, to: newStage });
}

export async function checkAndUpgrade(companyId: string): Promise<CompanyStage> {
  const evaluation = await evaluateStage(companyId);
  if (evaluation.shouldUpgrade) {
    await upgradeStage(companyId, evaluation.suggestedStage);
    return evaluation.suggestedStage;
  }
  return evaluation.currentStage;
}

export { STAGES };
export type { StageDefinition };
