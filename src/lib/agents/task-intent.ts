export type TaskIntent =
  | 'new_app_build'
  | 'existing_app_extension'
  | 'focused_repair'
  | 'ui_polish'
  | 'api_contract_fix'
  | 'auth_security_fix'
  | 'deployment_fix'
  | 'verification_only';

export type TaskIntentResult = {
  intent: TaskIntent;
  lane: 'build' | 'extend' | 'repair' | 'verify';
  reasons: string[];
};

export type TaskIntentInput = {
  title?: string | null;
  description?: string | null;
  tag?: string | null;
  productContext?: string | null;
};

const INTENTS: TaskIntent[] = [
  'new_app_build',
  'existing_app_extension',
  'focused_repair',
  'ui_polish',
  'api_contract_fix',
  'auth_security_fix',
  'deployment_fix',
  'verification_only',
];

const REPAIR_RE = /\b(repair|fix|broken|regression|failed|failure|failing|bug|canary failed|gate failed|missing|required fixes?|original canary failed)\b/i;
const EXISTING_RE = /\b(existing|same app|same repo|same service|do not create a new app|preserve|extend|update current|already deployed)\b/i;
const API_RE = /\b(api|endpoint|route|payload|contract|request|response|status code|schema field|snake_case|camelcase|webhook)\b/i;
const AUTH_RE = /\b(auth|sign[- ]?in|sign[- ]?out|signup|login|logout|session|password|oauth|permission|security)\b/i;
const DEPLOY_RE = /\b(render|deploy|deployment|build failed|build log|runtime log|env var|service config|health check|pipeline)\b/i;
const UI_POLISH_RE = /\b(copy|spacing|style|visual|design|layout|color|font|button label|polish|responsive|mobile)\b/i;
const VERIFY_RE = /\b(verify|audit|check|test|inspect|confirm|replay)\b/i;
const BUILD_RE = /\b(build|create|ship|implement|generate|make)\b/i;

export function parseTaskIntent(value: string | null | undefined): TaskIntent | null {
  if (!value) return null;
  const normalized = value.trim() as TaskIntent;
  return INTENTS.includes(normalized) ? normalized : null;
}

export function classifyTaskIntent(input: TaskIntentInput): TaskIntentResult {
  const text = `${input.title ?? ''}\n${input.description ?? ''}\n${input.tag ?? ''}\n${input.productContext ?? ''}`;
  const reasons: string[] = [];
  const hasRepair = REPAIR_RE.test(text);
  const hasExisting = EXISTING_RE.test(text);
  const hasApi = API_RE.test(text);
  const hasAuth = AUTH_RE.test(text);
  const hasDeploy = DEPLOY_RE.test(text);
  const hasUiPolish = UI_POLISH_RE.test(text);
  const hasVerify = VERIFY_RE.test(text);

  if (hasRepair) reasons.push('repair_signal');
  if (hasExisting) reasons.push('existing_app_signal');
  if (hasApi) reasons.push('api_contract_signal');
  if (hasAuth) reasons.push('auth_security_signal');
  if (hasDeploy) reasons.push('deployment_signal');
  if (hasUiPolish) reasons.push('ui_polish_signal');
  if (hasVerify) reasons.push('verification_signal');

  if (hasRepair && hasAuth) return { intent: 'auth_security_fix', lane: 'repair', reasons };
  if (hasRepair && hasApi) return { intent: 'api_contract_fix', lane: 'repair', reasons };
  if (hasRepair && hasDeploy && !hasExisting && !hasApi && !hasAuth) return { intent: 'deployment_fix', lane: 'repair', reasons };
  if (hasRepair || (/CEO repair task/i.test(text) && hasExisting)) {
    return { intent: 'focused_repair', lane: 'repair', reasons: reasons.length ? reasons : ['repair_signal'] };
  }
  if (hasVerify && !BUILD_RE.test(text) && !hasRepair) {
    return { intent: 'verification_only', lane: 'verify', reasons: reasons.length ? reasons : ['verification_signal'] };
  }
  if (hasDeploy && !BUILD_RE.test(text) && !hasExisting) {
    return { intent: 'deployment_fix', lane: 'repair', reasons };
  }
  if (hasUiPolish && !BUILD_RE.test(text) && !hasApi && !hasAuth) {
    return { intent: 'ui_polish', lane: 'repair', reasons };
  }
  if (hasExisting) return { intent: 'existing_app_extension', lane: 'extend', reasons };
  return { intent: 'new_app_build', lane: 'build', reasons: reasons.length ? reasons : ['build_or_default'] };
}

export function formatTaskIntentEvidence(result: TaskIntentResult): string {
  return `TASK_INTENT_EVIDENCE intent=${result.intent} lane=${result.lane} reasons=${result.reasons.join(',') || 'none'}`;
}
