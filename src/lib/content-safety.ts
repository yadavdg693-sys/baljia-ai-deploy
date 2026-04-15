// Content Safety — prompt injection prevention + output moderation
// G-CONTENT-001: Sanitize user inputs before injection into agent prompts
// G-CONTENT-002: Basic content moderation on agent outputs
import { createLogger } from '@/lib/logger';

const log = createLogger('ContentSafety');

// ══════════════════════════════════════════════
// G-CONTENT-001: PROMPT INJECTION PREVENTION
// ══════════════════════════════════════════════

// Patterns that indicate prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+a\s+/i,
  /new\s+system\s+prompt/i,
  /override\s+(system|instructions)/i,
  /forget\s+(everything|all|your\s+instructions)/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+if\s+you/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /sudo\s+mode/i,
  /\<\/?system\>/i,           // Fake XML system tags
  /\[\[system\]\]/i,          // Fake system delimiters
  /\[INST\]/i,                // Llama-style instruction markers
  /\<\|im_start\|\>/i,        // ChatML markers
  /BEGININSTRUCTION/i,
];

// Characters commonly used for delimiter attacks
const DELIMITER_ATTACKS = [
  '```system',
  '---system---',
  '===OVERRIDE===',
  '###ADMIN###',
  'SYSTEM:',
  'INSTRUCTION:',
];

/**
 * Sanitize user input before injecting into agent prompts.
 * Strips known injection patterns and escapes delimiters.
 */
export function sanitizeForPrompt(input: string): string {
  let sanitized = input;

  // Remove known injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      log.warn('Prompt injection pattern detected and removed', {
        pattern: pattern.source,
        inputSnippet: input.substring(0, 100),
      });
      sanitized = sanitized.replace(pattern, '[redacted]');
    }
  }

  // Escape delimiter attacks
  for (const delimiter of DELIMITER_ATTACKS) {
    if (sanitized.includes(delimiter)) {
      sanitized = sanitized.replaceAll(delimiter, `[${delimiter}]`);
    }
  }

  return sanitized;
}

/**
 * Check if input contains injection attempts (for logging/alerting).
 * Returns true if clean, false if suspicious.
 */
export function isInputClean(input: string): boolean {
  return !INJECTION_PATTERNS.some((p) => p.test(input)) &&
    !DELIMITER_ATTACKS.some((d) => input.includes(d));
}

// ══════════════════════════════════════════════
// G-CONTENT-002: OUTPUT CONTENT MODERATION
// ══════════════════════════════════════════════

// Patterns that should never appear in agent outputs
const OUTPUT_BLOCK_PATTERNS = [
  // Credential exposure
  /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"]\S{10,}/i,
  // Leaked env vars
  /(?:ANTHROPIC|OPENAI|STRIPE|GEMINI|AWS|TWITTER|META)_(?:API_KEY|SECRET|TOKEN)\s*=\s*\S+/i,
  // SQL injection in output (agent generating exploit code)
  /(?:DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s+TABLE)\s+(?!information_schema)/i,
  // Profanity/hate speech basic filter
  /\b(?:fuck|shit|damn|ass|bitch|dick)\b/i,
];

// Patterns that should be flagged but not blocked
const OUTPUT_WARN_PATTERNS = [
  // Shell commands that could be dangerous
  /(?:rm\s+-rf|sudo\s+rm|mkfs|format\s+c:)/i,
  // Private data patterns
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/,             // SSN pattern
  /\b(?:\d{4}[-\s]?){4}\b/,                       // Credit card pattern
];

interface ModerationResult {
  clean: boolean;
  blocked: boolean;
  warnings: string[];
  sanitized: string;
}

/**
 * Moderate agent output before returning to the founder.
 * Blocks dangerous content, warns on suspicious patterns.
 */
export function moderateOutput(output: string): ModerationResult {
  const warnings: string[] = [];
  let sanitized = output;
  let blocked = false;

  // Check block patterns
  for (const pattern of OUTPUT_BLOCK_PATTERNS) {
    if (pattern.test(sanitized)) {
      log.warn('Agent output contained blocked content', {
        pattern: pattern.source,
        outputSnippet: output.substring(0, 100),
      });
      sanitized = sanitized.replace(pattern, '[content removed]');
      blocked = true;
    }
  }

  // Check warn patterns
  for (const pattern of OUTPUT_WARN_PATTERNS) {
    if (pattern.test(sanitized)) {
      warnings.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }

  return {
    clean: !blocked && warnings.length === 0,
    blocked,
    warnings,
    sanitized: blocked ? sanitized : output,
  };
}
