const DEFAULT_MAX_TOOL_TURNS = 16;
const DEFAULT_MAX_RESPONSE_TOKENS = 6144;
const DEFAULT_ROLLING_TASK_LIMIT = 3;

export const CEO_PROCESSING_LIMIT_TEXT =
  '\n\n*(Reached processing limit: I hit the internal tool loop before finishing every action. Send one more message and I will continue from the last completed step.)*';

type EnvLike = Record<string, string | undefined>;

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getCeoMaxToolTurns(env: EnvLike = process.env): number {
  return boundedInteger(env.CEO_MAX_TOOL_TURNS, DEFAULT_MAX_TOOL_TURNS, 5, 30);
}

export function getCeoMaxResponseTokens(env: EnvLike = process.env): number {
  return boundedInteger(env.CEO_MAX_RESPONSE_TOKENS, DEFAULT_MAX_RESPONSE_TOKENS, 1024, 12000);
}

export function getCeoRollingTaskLimit(env: EnvLike = process.env): number {
  return boundedInteger(env.CEO_ROLLING_TASK_LIMIT, DEFAULT_ROLLING_TASK_LIMIT, 1, 12);
}
