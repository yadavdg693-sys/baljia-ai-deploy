// Sanitizer — scans a string for banned terms and returns the result.
//
// Two modes:
//   - 'strict' throws on any hit. Use for HARDCODED strings in source code
//     (activity lines, memory sections, task titles the engineer typed).
//   - 'soft'   returns violations + redacted text. Use for LLM OUTPUT where
//     we can't block onboarding over a single word — we redact + log so
//     the founder gets a clean string and we still see the leak in Sentry.
//
// Violation logging goes through the standard logger so it shows up in
// Sentry breadcrumbs. The `companyId` context is optional for call sites
// that don't have it (e.g. outbound email body sanitization).

import { createLogger } from '@/lib/logger';
import { STRICT_BANNED_TERMS, ALL_BANNED_TERMS, type BannedTerm } from './banned-terms';

const log = createLogger('FounderSafety');

export type SanitizeMode = 'strict' | 'soft';

export interface SanitizeViolation {
  label: string;
  category: BannedTerm['category'];
  /** Byte offset of the match in the INPUT text. */
  index: number;
  /** The exact text that matched (useful for distinguishing "Neon" from "Neon DB"). */
  matched: string;
}

export interface SanitizeResult {
  /** The cleaned text — in strict mode this is the input unchanged (only runs
   *  when there are zero violations). In soft mode, banned terms are replaced
   *  with `[redacted]`. */
  clean: string;
  /** Every banned-term hit found in the input. */
  violations: SanitizeViolation[];
  /** Shortcut — true iff violations.length > 0. */
  hadViolations: boolean;
}

/** Build a regex for a single banned term. Uses word boundaries on both sides
 *  unless the pattern starts with `@` or ends with a non-word character (e.g.
 *  `@opennextjs`, `Hunter.io`) where standard word boundaries would break. */
function buildRegex(term: BannedTerm): RegExp {
  // Escape regex metachars in the pattern
  const escaped = term.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+'); // whitespace matches one-or-more spaces

  // Wrap in word boundaries carefully — only if both ends are word chars
  const startsWithWord = /^[\w]/.test(term.pattern);
  const endsWithWord = /[\w]$/.test(term.pattern);
  const prefix = startsWithWord ? '\\b' : '';
  const suffix = endsWithWord ? '\\b' : '';

  const flags = term.caseSensitive ? 'g' : 'gi';
  return new RegExp(prefix + escaped + suffix, flags);
}

function findViolations(text: string, terms: BannedTerm[]): SanitizeViolation[] {
  const found: SanitizeViolation[] = [];
  for (const term of terms) {
    const re = buildRegex(term);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.push({
        label: term.label,
        category: term.category,
        index: m.index,
        matched: m[0],
      });
      // Avoid infinite loop on zero-width matches (shouldn't happen here but be safe)
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function redact(text: string, violations: SanitizeViolation[]): string {
  if (violations.length === 0) return text;
  // Apply replacements back-to-front so indices stay valid
  let out = text;
  for (let i = violations.length - 1; i >= 0; i--) {
    const v = violations[i];
    out = out.slice(0, v.index) + '[redacted]' + out.slice(v.index + v.matched.length);
  }
  return out;
}

export interface SanitizeOptions {
  mode?: SanitizeMode;
  /** Use ALL banned terms (includes vendors). Default uses STRICT set only
   *  (infra + internal). */
  includeVendors?: boolean;
  /** Optional context for violation logs (e.g. which callsite, which companyId). */
  context?: Record<string, string | number | null | undefined>;
}

/**
 * Scan `text` for banned terms and handle according to mode.
 *
 * Strict mode: throws on first violation. Use when a human wrote the string.
 * Soft mode:  redacts violations and logs them. Use for LLM output.
 */
export function sanitizeForFounder(text: string, opts: SanitizeOptions = {}): SanitizeResult {
  const { mode = 'strict', includeVendors = false, context } = opts;
  const termSet = includeVendors ? ALL_BANNED_TERMS : STRICT_BANNED_TERMS;
  const violations = findViolations(text, termSet);

  if (violations.length === 0) {
    return { clean: text, violations: [], hadViolations: false };
  }

  if (mode === 'strict') {
    log.error('founder-safety: strict-mode violation', {
      ...context,
      violations: violations.map((v) => v.label),
      sample: text.slice(0, 200),
    });
    const labels = violations.map((v) => v.label).join(', ');
    throw new FounderSafetyViolation(
      `Banned term${violations.length > 1 ? 's' : ''} in founder-visible text: ${labels}`,
      violations,
    );
  }

  // Soft mode — redact, log, return
  log.warn('founder-safety: soft-mode violation (redacted)', {
    ...context,
    violations: violations.map((v) => v.label),
    sample: text.slice(0, 200),
  });
  return {
    clean: redact(text, violations),
    violations,
    hadViolations: true,
  };
}

export class FounderSafetyViolation extends Error {
  public readonly violations: SanitizeViolation[];
  constructor(message: string, violations: SanitizeViolation[]) {
    super(message);
    this.name = 'FounderSafetyViolation';
    this.violations = violations;
  }
}
