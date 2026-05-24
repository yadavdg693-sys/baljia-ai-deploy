import type { OnboardingJourney } from '@/types';

export type LandingTemplateKind =
  | 'saas'
  | 'local_service'
  | 'ecommerce'
  | 'content_coaching'
  | 'marketplace'
  | 'existing_business'
  | 'general_business';

export type LandingArtifactKind =
  | 'pipeline_board'
  | 'app_dashboard'
  | 'booking_flow'
  | 'storefront_drop'
  | 'coaching_map'
  | 'marketplace_match'
  | 'growth_snapshot'
  | 'service_scope'
  | 'general_snapshot';

export interface LandingTemplateSignals {
  journey: OnboardingJourney;
  industryId?: string | null;
  text?: string | null;
}

const MARKETPLACE_RE = /\b(marketplace|match(?:es|ing)?|buyers?\s+and\s+sellers?|supply\s+and\s+demand|two-sided|two sided|vendors?|providers?\s+with\s+customers?|directory)\b/i;
const ECOMMERCE_RE = /\b(ecommerce|e-commerce|shopify|storefront|store|retail|dtc|d2c|merch|product\s+drop|inventory|cart|checkout|subscription\s+box|skincare|apparel|fashion|cosmetics|jewelry)\b/i;
const COACHING_RE = /\b(coach(?:ing)?|course|cohort|creator|newsletter|community|curriculum|workshop|training|mentor(?:ing)?|content|lead\s+magnet|ebook|playbook)\b/i;
const LOCAL_SERVICE_RE = /\b(clinic|salon|restaurant|cafe|dental|dentist|law|legal|agency|studio|consulting|consultancy|service\s+business|booking|appointment|quote|repair|cleaning|plumber|gym|fitness|spa|therapy|real\s+estate)\b/i;
const SAAS_RE = /\b(saas|software|platform|dashboard|app|tool|automation|agent|ai|workflow|crm|analytics|api|developer|devtool|productivity|job\s+search|resume|pipeline|portal)\b/i;

export function resolveLandingTemplateKind(input: LandingTemplateSignals): LandingTemplateKind {
  if (input.journey === 'grow_my_company') return 'existing_business';

  const haystack = `${input.industryId ?? ''} ${input.text ?? ''}`.toLowerCase();

  if (MARKETPLACE_RE.test(haystack)) return 'marketplace';
  if (ECOMMERCE_RE.test(haystack)) return 'ecommerce';
  if (COACHING_RE.test(haystack)) return 'content_coaching';
  if (LOCAL_SERVICE_RE.test(haystack)) return 'local_service';
  if (SAAS_RE.test(haystack)) return 'saas';

  return 'general_business';
}

export function artifactKindForTemplate(kind: LandingTemplateKind): LandingArtifactKind {
  switch (kind) {
    case 'saas':
      return 'pipeline_board';
    case 'local_service':
      return 'booking_flow';
    case 'ecommerce':
      return 'storefront_drop';
    case 'content_coaching':
      return 'coaching_map';
    case 'marketplace':
      return 'marketplace_match';
    case 'existing_business':
      return 'growth_snapshot';
    case 'general_business':
    default:
      return 'general_snapshot';
  }
}
