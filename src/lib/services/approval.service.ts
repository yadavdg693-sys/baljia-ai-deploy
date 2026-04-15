// Approval Service — Stored approval records with scope + expiry
// Architecture: Each approval is a record with scope, expiry, and audit trail
//
// Approval types:
// - task_approval: one-time approval for a specific task
// - scope_approval: time-limited approval for a task tag/category
// - blanket_approval: broad approval with expiry (e.g., "auto-approve all SEO tasks for 7 days")

import { db, platformEvents } from '@/lib/db';
import { sql, and, eq, gte, lte } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Approval');

export type ApprovalScope = 'task' | 'tag' | 'agent' | 'blanket';

export interface ApprovalRecord {
  id: string;
  company_id: string;
  scope: ApprovalScope;
  scope_value: string;      // task_id, tag name, agent_id, or '*'
  granted_by: string;       // user_id of the approver
  granted_at: string;       // ISO timestamp
  expires_at: string | null; // null = no expiry (one-time approvals)
  max_credits: number | null; // Credit limit for this approval
  credits_used: number;
  is_revoked: boolean;
  notes: string | null;
}

// In-memory approval cache (refreshed from DB on startup)
// For production: use Redis or DB query
const approvalCache = new Map<string, ApprovalRecord[]>();

/**
 * Grant an approval for a company.
 * Stored in platform_events for persistence + audit.
 */
export async function grantApproval(input: {
  companyId: string;
  scope: ApprovalScope;
  scopeValue: string;
  grantedBy: string;
  expiryHours?: number;
  maxCredits?: number;
  notes?: string;
}): Promise<ApprovalRecord> {
  const now = new Date();
  const record: ApprovalRecord = {
    id: crypto.randomUUID(),
    company_id: input.companyId,
    scope: input.scope,
    scope_value: input.scopeValue,
    granted_by: input.grantedBy,
    granted_at: now.toISOString(),
    expires_at: input.expiryHours
      ? new Date(now.getTime() + input.expiryHours * 3600_000).toISOString()
      : null,
    max_credits: input.maxCredits ?? null,
    credits_used: 0,
    is_revoked: false,
    notes: input.notes ?? null,
  };

  // Persist as platform event
  await db.insert(platformEvents).values({
    company_id: input.companyId,
    event_type: 'approval_granted',
    payload: record,
    is_public_safe: false,
  });

  // Update cache
  const existing = approvalCache.get(input.companyId) ?? [];
  existing.push(record);
  approvalCache.set(input.companyId, existing);

  log.info('Approval granted', {
    companyId: input.companyId,
    scope: input.scope,
    scopeValue: input.scopeValue,
    expiryHours: input.expiryHours,
  });

  return record;
}

/**
 * Check if a task is pre-approved for execution.
 * Checks against active, non-expired, non-revoked approvals.
 */
export function isPreApproved(
  companyId: string,
  taskTag: string,
  agentId: number,
  taskId: string,
): boolean {
  const approvals = approvalCache.get(companyId) ?? [];
  const now = new Date();

  for (const approval of approvals) {
    // Skip revoked or expired
    if (approval.is_revoked) continue;
    if (approval.expires_at && new Date(approval.expires_at) < now) continue;
    // Skip credit-exhausted approvals
    if (approval.max_credits !== null && approval.credits_used >= approval.max_credits) continue;

    switch (approval.scope) {
      case 'task':
        if (approval.scope_value === taskId) return true;
        break;
      case 'tag':
        if (approval.scope_value === taskTag) return true;
        break;
      case 'agent':
        if (approval.scope_value === String(agentId)) return true;
        break;
      case 'blanket':
        if (approval.scope_value === '*') return true;
        break;
    }
  }

  return false;
}

/**
 * Record credit usage against an approval.
 * Decrements the remaining credit allowance.
 */
export function recordApprovalUsage(companyId: string, taskId: string, credits: number): void {
  const approvals = approvalCache.get(companyId) ?? [];

  for (const approval of approvals) {
    if (approval.is_revoked) continue;
    if (approval.expires_at && new Date(approval.expires_at) < new Date()) continue;

    // Match against the most relevant approval
    if (
      approval.scope === 'blanket' ||
      (approval.scope === 'task' && approval.scope_value === taskId)
    ) {
      approval.credits_used += credits;
      break;
    }
  }
}

/**
 * Revoke an approval by ID.
 */
export async function revokeApproval(companyId: string, approvalId: string): Promise<boolean> {
  const approvals = approvalCache.get(companyId) ?? [];
  const approval = approvals.find((a) => a.id === approvalId);

  if (!approval) return false;

  approval.is_revoked = true;

  await db.insert(platformEvents).values({
    company_id: companyId,
    event_type: 'approval_revoked',
    payload: { approval_id: approvalId },
    is_public_safe: false,
  });

  log.info('Approval revoked', { companyId, approvalId });
  return true;
}

/**
 * List active approvals for a company.
 */
export function listActiveApprovals(companyId: string): ApprovalRecord[] {
  const approvals = approvalCache.get(companyId) ?? [];
  const now = new Date();

  return approvals.filter((a) => {
    if (a.is_revoked) return false;
    if (a.expires_at && new Date(a.expires_at) < now) return false;
    if (a.max_credits !== null && a.credits_used >= a.max_credits) return false;
    return true;
  });
}
