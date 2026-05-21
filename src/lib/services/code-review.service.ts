// LLM-based code review for the agent's most recent commit. Runs as a
// separate Claude pass over the diff with a focused prompt drawn from the
// Backend Quality Bar. Catches issues that:
//
//   - Pattern-based static-code-scan misses (semantic correctness, business
//     logic mistakes, subtle async ordering, data-flow problems).
//   - Runtime journey verification cannot see (unhandled error paths, dead
//     branches, magic numbers, hidden coupling between handlers).
//
// Trade-off: one extra LLM call per build (~3-15s, $0.01-0.05). Catches a
// real category of issues. Use as advisory in the verifier today; can be
// promoted to hard later when adoption is broad.
//
// The reviewer is given:
//   - The diff (truncated to 30KB if larger)
//   - A scoped checklist of what to look for
//
// It returns structured findings: severity, file, line, issue, suggested fix.

import { createLogger } from '@/lib/logger';
import { createAnthropicWithOAuthAsync, withClaudeCodeIdentity } from '@/lib/anthropic-oauth';

// Use Haiku for code review — fast + cheap, and the task is well-bounded.
// Override via env if needed. Keep in sync with the Haiku constant in
// agent-factory.ts.
const REVIEW_MODEL = process.env.CODE_REVIEW_MODEL || 'claude-haiku-4-5-20251001';

const log = createLogger('CodeReview');

interface ReviewFinding {
  severity: 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  category: string;
  issue: string;
  suggested_fix?: string;
}

interface ReviewResult {
  ok: boolean;
  findings: ReviewFinding[];
  summary: string;
  rawResponse?: string;
}

const REVIEW_PROMPT = `You are reviewing code that an autonomous AI engineering agent just pushed to a founder's GitHub repo, BEFORE it's deployed to production. Your job is to catch issues that runtime verification cannot see by definition.

Look for, in order of importance:

HIGH severity (must be fixed before deploy):
- Unhandled async errors (await missing, .then without .catch, fire-and-forget Promises)
- Auth bypass (route forgot requireAuth, session check after redirect, IDOR via missing user_id check on ownership)
- SQL injection (template-literal SQL, untyped user input concatenated into queries)
- Secrets in code or logs (API keys, DATABASE_URL, SESSION_SECRET appearing in console.log/logger calls)
- Silent failures (catch block with empty body, return false, return null without logging)
- Race conditions (read-then-write without transaction, last-write-wins where it matters)

MEDIUM severity:
- Untyped/unvalidated user input passed to external APIs
- Missing input length/format validation on POST handlers
- Inconsistent error response shapes (some routes return string, others {error:...})
- DB queries without LIMIT or pagination on user-facing list endpoints
- Hardcoded test fixtures (test+xxx@baljia.test) leaked into production code

LOW severity:
- TODO/FIXME comments in committed code
- Dead code (unreachable branches, unused imports)
- Magic numbers without named constants
- Inconsistent naming conventions

Return STRICT JSON, nothing else. Schema:
{
  "summary": "one-sentence overall assessment",
  "findings": [
    { "severity": "high|medium|low", "file": "path", "line": 123, "category": "auth|sql|async|secret|other", "issue": "what's wrong", "suggested_fix": "what to change" }
  ]
}

If the diff is clean, return: { "summary": "Clean — no issues found.", "findings": [] }

DO NOT invent issues. If unsure, omit. False positives waste the agent's time and credibility.`;

export async function reviewDiff(diff: string, repo: string): Promise<ReviewResult> {
  if (!diff || diff.trim().length < 20) {
    return { ok: true, findings: [], summary: 'Diff too small to review meaningfully.' };
  }

  // Truncate large diffs — the review LLM doesn't need every line of a 50KB
  // change to surface the high-severity issues. Bias toward keeping the
  // beginning (which usually has new file headers + the most code).
  const MAX_DIFF_BYTES = 30_000;
  const truncated = diff.length > MAX_DIFF_BYTES
    ? `${diff.slice(0, MAX_DIFF_BYTES)}\n\n... (diff truncated at ${MAX_DIFF_BYTES} bytes; original was ${diff.length})`
    : diff;

  let client, isOAuth;
  try {
    ({ client, isOAuth } = await createAnthropicWithOAuthAsync());
  } catch (err) {
    log.warn('No Anthropic provider available for code review — skipping', { err: err instanceof Error ? err.message : String(err) });
    return { ok: true, findings: [], summary: 'Code review skipped — no Anthropic provider available.' };
  }

  const userMessage = `Repo: ${repo}\n\n--- DIFF ---\n${truncated}`;
  const systemMessage = withClaudeCodeIdentity(REVIEW_PROMPT, isOAuth);

  let rawResponse = '';
  try {
    const resp = await client.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 2_000,
      system: systemMessage,
      messages: [{ role: 'user', content: userMessage }],
    });
    const textBlock = resp.content.find((c) => c.type === 'text') as { type: 'text'; text: string } | undefined;
    rawResponse = textBlock?.text ?? '';
  } catch (err) {
    log.error('Code review LLM call failed', { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, findings: [], summary: `Code review LLM call failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Parse JSON; tolerant of code-fence wrapping.
  const jsonText = rawResponse
    .replace(/^[\s\S]*?```(?:json)?/i, '')
    .replace(/```[\s\S]*$/, '')
    .trim() || rawResponse.trim();

  try {
    const parsed = JSON.parse(jsonText) as { summary?: string; findings?: ReviewFinding[] };
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    return {
      ok: true,
      findings,
      summary: parsed.summary ?? (findings.length === 0 ? 'Clean — no issues found.' : `${findings.length} finding(s)`),
      rawResponse,
    };
  } catch (err) {
    log.warn('Code review response was not parseable JSON', { sample: rawResponse.slice(0, 300) });
    return {
      ok: false,
      findings: [],
      summary: 'Code review response was not parseable JSON.',
      rawResponse,
    };
  }
}

export function summarizeReview(result: ReviewResult): string {
  if (!result.ok) return `CODE REVIEW SKIPPED: ${result.summary}`;
  if (result.findings.length === 0) return `CODE REVIEW PASS: ${result.summary}`;
  const high = result.findings.filter((f) => f.severity === 'high').length;
  const medium = result.findings.filter((f) => f.severity === 'medium').length;
  const low = result.findings.filter((f) => f.severity === 'low').length;
  const lines = [
    `CODE REVIEW: ${result.findings.length} finding(s) — high=${high} medium=${medium} low=${low}`,
    `  ${result.summary}`,
    '',
  ];
  for (const f of result.findings.slice(0, 20)) {
    lines.push(`  [${f.severity.toUpperCase()}] ${f.file}${f.line ? `:${f.line}` : ''} (${f.category})`);
    lines.push(`    Issue: ${f.issue}`);
    if (f.suggested_fix) lines.push(`    Fix:   ${f.suggested_fix}`);
  }
  if (result.findings.length > 20) lines.push(`  ... and ${result.findings.length - 20} more`);
  return lines.join('\n');
}

export type { ReviewFinding, ReviewResult };
