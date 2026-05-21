// Sanitizer — scans a string for banned terms and returns the result.
//
// Three modes (in order of aggressiveness):
//   - 'audit'  logs violations but returns text UNCHANGED. Use for LLM output
//              where over-sanitization would mangle legitimate content (market
//              research, landing HTML). Gives us telemetry without side effects.
//   - 'soft'   redacts violations with [redacted] and logs. Use when we MUST
//              keep banned terms off the founder's screen — platform-authored
//              strings (activity lines, memory sections we compose ourselves).
//   - 'strict' throws on any hit. Use for HARDCODED strings via asFounderSafe()
//              so the test suite catches them at build time.
//
// Principle: the banlist is narrow (phrases only, no bare product names), so
// any hit is almost certainly a real leak. That means `soft` mode is safe to
// use on platform-authored strings — false positives are rare. For LLM output
// where we can't guarantee narrow phrasing, prefer `audit` so we never mangle
// legitimate text.

import { createLogger } from '@/lib/logger';
import { STRICT_BANNED_TERMS, ALL_BANNED_TERMS, type BannedTerm } from './banned-terms';

const log = createLogger('FounderSafety');

export type SanitizeMode = 'strict' | 'soft' | 'audit';

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
  /** Phrases (case-insensitive) that, even if banned, should pass through
   *  unredacted at this callsite. Use VERY sparingly — only for genuinely
   *  internal callsites (agent-only briefings, system-source task metadata)
   *  where the text never renders on the founder UI. The default is empty. */
  allowedTerms?: string[];
}

/**
 * Scan `text` for banned terms and handle according to mode.
 *
 * Strict mode: throws on first violation. Use when a human wrote the string.
 * Soft mode:  redacts violations and logs them. Use for LLM output.
 */
export function sanitizeForFounder(text: string, opts: SanitizeOptions = {}): SanitizeResult {
  const { mode = 'strict', includeVendors = false, context, allowedTerms } = opts;
  const termSet = includeVendors ? ALL_BANNED_TERMS : STRICT_BANNED_TERMS;
  const allowedLower = (allowedTerms ?? []).map((t) => t.toLowerCase());
  let violations = findViolations(text, termSet);

  // Filter out allowedTerms — keep the violation list scoped to truly leaking phrases.
  if (allowedLower.length > 0) {
    violations = violations.filter((v) => !allowedLower.includes(v.label.toLowerCase()));
  }

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

  if (mode === 'audit') {
    // Log only — never modify the text. Use this when mangling the string would
    // be worse than a subtle leak (LLM outputs, landing HTML, market research).
    log.warn('founder-safety: audit-mode violation (not redacted)', {
      ...context,
      violations: violations.map((v) => v.label),
      sample: text.slice(0, 200),
    });
    return {
      clean: text,
      violations,
      hadViolations: true,
    };
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
