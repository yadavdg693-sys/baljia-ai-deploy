// JSON output helper — wraps callSmallLLM with JSON-only prompting + parse + retry-once
// Used by Phase 3a stages that produce structured outputs (market research, mission, idea shapes)
//
// Founder-safety: outputs are persisted to founder-visible fields
// (documents.content, tasks.description, etc.). If a caller passes
// `sanitizeFields` / `sanitizeArrayOfObjects`, we screen those fields
// for banned terms. On violation we retry ONCE with an explicit
// "do not mention X, Y, Z" instruction, then fall back to in-place
// redaction so the founder never sees the leak. Matches the "retry once,
// then redact" pattern the rest of this file uses for JSON parse errors.

import { createLogger } from '@/lib/logger';
import { callSmallLLM } from '../llm/small-llm';
import { sanitizeForFounder, type SanitizeViolation } from '@/lib/founder-safety/sanitize';
import type { z } from 'zod';

const log = createLogger('OnboardingJsonMode');

export interface JsonModeOptions {
  maxTokens?: number;
  retryOnce?: boolean;
  /** Runtime contract for model output. Parseable JSON is not enough for
   * onboarding because missing keys can quietly corrupt later stages. */
  schema?: z.ZodType<unknown>;
  /** Top-level string fields to scan for banned terms. Use for simple
   *  shapes like `{ refined_idea: string, changes_made: string }`. */
  sanitizeFields?: string[];
  /** Array-of-objects fields — every object's string-leaf values are
   *  scanned. Use for shapes like `{ competitors: [{ name, gap }] }`. */
  sanitizeArrayOfObjects?: string[];
}

// Calls the LLM expecting JSON-only output. Strips common wrapping (```json / ```)
// and parses. Retries once with stricter prompt if first parse fails.
// If sanitizeFields/sanitizeArrayOfObjects are provided, screens those paths
// for banned terms and retries with a "do not mention" instruction.
export async function callSmallLLMJson<T>(
  prompt: string,
  opts: JsonModeOptions = {},
): Promise<T> {
  const maxTokens = opts.maxTokens ?? 2500;
  const jsonOnlyPrompt = `${prompt}

Respond with ONLY a valid JSON object. No prose before or after. No markdown code fences. Start your response with { and end with }.`;

  let parsed: T;
  try {
    const response = await callSmallLLM(jsonOnlyPrompt, maxTokens);
    parsed = parseJson<T>(response);
    parsed = validateSchema<T>(parsed, opts.schema);
  } catch (err) {
    if (opts.retryOnce === false) throw err;
    log.warn('JSON parse/validation failed, retrying once', { error: err instanceof Error ? err.message : String(err) });

    const retryPrompt = `${prompt}

CRITICAL: Your previous response could not be parsed or did not match the required schema. Respond with ONLY a valid JSON object, starting with { and ending with }. Include every required key exactly as requested. No prose, no markdown, no commentary.`;
    const response = await callSmallLLM(retryPrompt, maxTokens);
    parsed = parseJson<T>(response);
    parsed = validateSchema<T>(parsed, opts.schema);
  }

  // Founder-safety screen — skip entirely if no fields declared
  if (!opts.sanitizeFields && !opts.sanitizeArrayOfObjects) {
    return parsed;
  }

  const violations = screenForBanned(parsed, opts.sanitizeFields ?? [], opts.sanitizeArrayOfObjects ?? []);
  if (violations.length === 0) {
    return parsed;
  }

  // Retry once with explicit avoidance list
  const bannedLabels = Array.from(new Set(violations.map((v) => v.label)));
  log.warn('LLM output contained banned terms — retrying with avoidance list', {
    bannedLabels,
    maxRetries: 1,
  });

  const avoidancePrompt = `${prompt}

CRITICAL — do NOT mention any of these words or phrases in your response: ${bannedLabels.join(', ')}.
These are infrastructure or internal terms the end user should never see.
Use generic language instead (e.g. "database" not a specific DB product, "web app" not a framework name).

Respond with ONLY a valid JSON object, starting with { and ending with }.`;

  try {
    const retryResponse = await callSmallLLM(avoidancePrompt, maxTokens);
    const retryParsed = parseJson<T>(retryResponse);
    const validatedRetryParsed = validateSchema<T>(retryParsed, opts.schema);
    const retryViolations = screenForBanned(
      validatedRetryParsed,
      opts.sanitizeFields ?? [],
      opts.sanitizeArrayOfObjects ?? [],
    );
    if (retryViolations.length === 0) {
      return validatedRetryParsed;
    }
    // Still contaminated — redact and return
    log.error('LLM output still contaminated after avoidance retry — redacting in place', {
      remainingLabels: Array.from(new Set(retryViolations.map((v) => v.label))),
    });
    return redactInPlace(validatedRetryParsed, opts.sanitizeFields ?? [], opts.sanitizeArrayOfObjects ?? []);
  } catch (retryErr) {
    log.error('Avoidance retry failed — redacting first-pass output', {
      error: retryErr instanceof Error ? retryErr.message : String(retryErr),
    });
    return redactInPlace(parsed, opts.sanitizeFields ?? [], opts.sanitizeArrayOfObjects ?? []);
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function screenForBanned<T>(
  obj: T,
  topLevelFields: string[],
  arrayOfObjectFields: string[],
): SanitizeViolation[] {
  if (!obj || typeof obj !== 'object') return [];
  const record = obj as Record<string, unknown>;
  const all: SanitizeViolation[] = [];

  for (const f of topLevelFields) {
    const value = record[f];
    if (typeof value === 'string') {
      all.push(...sanitizeForFounder(value, { mode: 'soft' }).violations);
    }
  }

  for (const f of arrayOfObjectFields) {
    const arr = record[f];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          for (const leaf of Object.values(item as Record<string, unknown>)) {
            if (typeof leaf === 'string') {
              all.push(...sanitizeForFounder(leaf, { mode: 'soft' }).violations);
            }
          }
        }
      }
    }
  }

  return all;
}

function redactInPlace<T>(
  obj: T,
  topLevelFields: string[],
  arrayOfObjectFields: string[],
): T {
  if (!obj || typeof obj !== 'object') return obj;
  const record = obj as Record<string, unknown>;

  for (const f of topLevelFields) {
    const v = record[f];
    if (typeof v === 'string') {
      record[f] = sanitizeForFounder(v, { mode: 'soft' }).clean;
    }
  }

  for (const f of arrayOfObjectFields) {
    const arr = record[f];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          for (const [k, leaf] of Object.entries(rec)) {
            if (typeof leaf === 'string') {
              rec[k] = sanitizeForFounder(leaf, { mode: 'soft' }).clean;
            }
          }
        }
      }
    }
  }

  return obj;
}

function parseJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Slice from first { to last } to tolerate trailing prose
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`No JSON object found in response: ${cleaned.slice(0, 200)}`);
  }
  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonStr) as T;
}

function validateSchema<T>(parsed: T, schema: z.ZodType<unknown> | undefined): T {
  if (!schema) return parsed;
  const result = schema.safeParse(parsed);
  if (result.success) return result.data as T;

  const issues = result.error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  throw new Error(`JSON schema validation failed: ${issues}`);
}
