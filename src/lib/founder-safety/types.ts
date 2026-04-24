// Branded type for strings that have been verified as safe for founder-visible
// DB fields. Use this in signatures of new emitters/writers that you want
// compile-time enforced. Existing write boundaries (emitActivity,
// appendMemorySection, createTask) already call sanitizeForFounder() in soft
// mode — this type is the LATER migration target once we want to force every
// caller to explicitly opt in.
//
// The `unique symbol` tag makes the type nominally distinct from `string`,
// so TypeScript rejects assignments from raw strings without a constructor.

import { sanitizeForFounder, type SanitizeOptions } from './sanitize';

declare const FounderSafeBrand: unique symbol;
export type FounderSafeString = string & { readonly [FounderSafeBrand]: true };

/**
 * Strict constructor — call sanitizer in strict mode. Throws if the input
 * contains any banned term. Use for HARDCODED strings in source code where
 * a violation is a real bug that should surface loudly.
 */
export function asFounderSafe(text: string, opts: Omit<SanitizeOptions, 'mode'> = {}): FounderSafeString {
  const r = sanitizeForFounder(text, { ...opts, mode: 'strict' });
  // Strict mode would have thrown; if we're here, text is clean.
  return r.clean as FounderSafeString;
}

/**
 * Soft constructor — sanitize LLM output, redact banned terms, return the
 * cleaned string as a FounderSafeString. Never throws. Use when you don't
 * control the source of the text (LLM completions, third-party API bodies).
 */
export function safeFromLlm(text: string, opts: Omit<SanitizeOptions, 'mode'> = {}): FounderSafeString {
  const r = sanitizeForFounder(text, { ...opts, mode: 'soft' });
  return r.clean as FounderSafeString;
}

/**
 * Escape hatch — trust a string without sanitization. Use ONLY for content
 * that cannot contain banned terms by construction (e.g. numeric IDs, slugs,
 * timestamps). Every call site should have a comment explaining why.
 */
export function trustedFounderSafe(text: string): FounderSafeString {
  return text as FounderSafeString;
}
