// Pre-tool-dispatch policy gate for autonomous agents.
//
// What it stops:
//   1. Destructive ops without explicit confirm (delete services, drop tables,
//      force-pushes, mass file deletions).
//   2. SQL containing DDL/DML keywords passed to read-only query tools.
//   3. Tools called outside the agent's authorized scope (e.g. write tools
//      from a research task).
//
// Pattern adapted from everything-claude-code's `beforeShellExecution` /
// `beforeTabFileRead` hook style, but server-side: instead of an exit code 2
// blocking the action at OS level, we return a structured BLOCKED message
// the agent sees as the tool result. The agent then has to reason about
// whether to retry with confirm:true or rethink the approach.
//
// Out of scope here: cost ceilings (handled by credit service), rate limits
// (handled by github-throttle), permission scope (handled by per-agent tool
// allowlists in agent-factory's case statements).

import type { Task } from '@/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('PolicyGate');

interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

type PolicyRule = (toolName: string, input: Record<string, unknown>, task: Task) => PolicyResult | null;

// ── Rules ────────────────────────────────────────────────────────────

// Render service deletion: must pass confirm:true. We had a near-miss earlier
// today where a recovery script deleted a Render service to retest a flow;
// in production that would have been catastrophic.
const requireRenderDeleteConfirm: PolicyRule = (toolName, input) => {
  if (toolName !== 'render_delete_service') return null;
  if (input.confirm !== true) {
    return { allowed: false, reason: 'render_delete_service requires explicit confirm:true. Pass {service_id, confirm: true} to proceed. The deletion is irreversible — service URL becomes a 404, deploy history is lost.' };
  }
  return { allowed: true };
};

// run_migration: block raw DROP/TRUNCATE/DELETE-without-WHERE. The migration
// tool is meant for forward-rolling DDL, not data destruction. Any "DROP TABLE"
// in a founder app's migration is almost certainly the agent confused.
const guardRunMigration: PolicyRule = (toolName, input) => {
  if (toolName !== 'run_migration') return null;
  const sql = String(input.sql ?? '').trim();
  if (!sql) return null;
  const upper = sql.toUpperCase();

  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/.test(upper)) {
    return { allowed: false, reason: 'run_migration: DROP TABLE/DATABASE/SCHEMA is blocked by policy. If you must remove a table, do it via a manual ops task with founder approval. For renames, prefer ALTER TABLE.' };
  }
  if (/\bTRUNCATE\b/.test(upper)) {
    return { allowed: false, reason: 'run_migration: TRUNCATE is blocked by policy. Mass data deletion needs founder approval.' };
  }
  if (/\bDELETE\s+FROM\s+\w+(\s|;|$)/.test(upper) && !/\bWHERE\b/.test(upper)) {
    return { allowed: false, reason: 'run_migration: unconditional DELETE (no WHERE clause) is blocked by policy. Add a WHERE clause that scopes the deletion or use a manual ops task.' };
  }
  return { allowed: true };
};

// query_company_db: should only accept SELECT. The tool already enforces this
// internally, but pinning it here makes the policy explicit and surfaces a
// clearer message earlier in the call stack.
const guardQueryCompanyDb: PolicyRule = (toolName, input) => {
  if (toolName !== 'query_company_db') return null;
  const sql = String(input.sql ?? '').trim();
  if (!sql) return null;
  if (!/^SELECT\b/i.test(sql)) {
    return { allowed: false, reason: 'query_company_db is read-only. Use run_migration for DDL/DML.' };
  }
  if (/;/.test(sql)) {
    return { allowed: false, reason: 'query_company_db: multiple statements not allowed. Send a single SELECT.' };
  }
  return { allowed: true };
};

// github_delete_file: any deletion in a founder repo should require
// confirm. Bulk deletions (many files in one commit) blocked entirely.
const requireGithubDeleteConfirm: PolicyRule = (toolName, input) => {
  if (toolName !== 'github_delete_file') return null;
  if (input.confirm !== true) {
    return { allowed: false, reason: 'github_delete_file requires confirm:true. Set {path, confirm: true} to proceed. The file removal commits to main.' };
  }
  // Don't allow nuking the framework files of the skeleton.
  const protectedPaths = ['server.js', 'package.json', 'render.yaml', 'db/schema.sql', 'README.md'];
  const pathStr = String(input.path ?? '');
  if (protectedPaths.includes(pathStr)) {
    return { allowed: false, reason: `github_delete_file: ${pathStr} is a framework file. The skeleton's hardening (Zod boot validation, trust-proxy, sessions) lives in these. Customize content via github_create_commit instead.` };
  }
  return { allowed: true };
};

// Force-push and reset operations would be catastrophic. Detect via tool input.
const blockForcePush: PolicyRule = (toolName, input) => {
  if (toolName === 'github_create_commit' && input.force === true) {
    return { allowed: false, reason: 'force-push is blocked by policy. Resolve the merge conflict instead, or open a fresh branch via github_create_branch.' };
  }
  return null;
};

const RULES: PolicyRule[] = [
  requireRenderDeleteConfirm,
  guardRunMigration,
  guardQueryCompanyDb,
  requireGithubDeleteConfirm,
  blockForcePush,
];

// ── Public API ───────────────────────────────────────────────────────

export function checkToolPolicy(toolName: string, input: Record<string, unknown>, task: Task): PolicyResult {
  for (const rule of RULES) {
    const result = rule(toolName, input, task);
    if (result) {
      if (!result.allowed) {
        log.warn('Tool call blocked by policy', {
          taskId: task.id,
          companyId: task.company_id,
          tool: toolName,
          reason: result.reason,
        });
      }
      return result;
    }
  }
  return { allowed: true };
}

/** Wraps the dispatcher: if the policy blocks the call, return the
 *  block reason as the tool result so the agent sees it in its loop. */
export async function withPolicyGate(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
  dispatch: () => Promise<string>,
): Promise<string> {
  const policy = checkToolPolicy(toolName, input, task);
  if (!policy.allowed) {
    return `BLOCKED by policy: ${policy.reason ?? 'destructive operation requires explicit confirm or scope review.'}`;
  }
  return dispatch();
}
