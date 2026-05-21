const PLANNING_SECTION_RE = /^\s*(?:Mandatory planning before implementation|Use the normal Engineering app-build workflow before implementation|Baseline canary setup requirements|Evaluation baseline setup requirements):\s*$/i;
const VERIFICATION_SECTION_RE = /^\s*Required verification:\s*$/i;

const STRIP_LINE_PATTERNS = [
  /^\s*Required scenario capabilities:\s*.*$/i,
  /^\s*Completion rule:\s*.*$/i,
  /^\s*-?\s*(?:Commit\/push|After final deploy|If Render custom-domain|Call check_url_health|Call verify_browser_ui|Call verify_interaction_contract|Call static_code_scan|Update codebase map)\b.*$/i,
  /^\s*-?\s*Do not complete if\b.*$/i,
  /^\s*-?\s*For pgvector\/RAG\b.*$/i,
  /^\s*-?\s*For AI text generation\b.*$/i,
];

/**
 * Remove harness/planning instructions while preserving product requirements.
 * Canary/eval prompts often include tool lists with words like Stripe, RAG, or
 * email; those should not drive domain/capability/lane classification.
 */
export function stripPlanningHarnessMetadata(text: string | null | undefined): string {
  const original = String(text ?? '').trim();
  if (!original) return '';

  const kept: string[] = [];
  let skippingPlanningBlock = false;
  let skippingVerificationBlock = false;

  for (const line of original.split(/\r?\n/)) {
    if (PLANNING_SECTION_RE.test(line)) {
      skippingPlanningBlock = true;
      continue;
    }

    if (VERIFICATION_SECTION_RE.test(line)) {
      skippingVerificationBlock = true;
      continue;
    }

    if (skippingPlanningBlock) {
      if (line.trim() === '') {
        skippingPlanningBlock = false;
      }
      continue;
    }

    if (skippingVerificationBlock) {
      if (line.trim() === '') {
        skippingVerificationBlock = false;
      }
      continue;
    }

    if (STRIP_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    kept.push(line);
  }

  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || original;
}
