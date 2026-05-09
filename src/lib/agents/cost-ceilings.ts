// Per-run cost tracking primitives for the agent watchdog.
//
// Two responsibilities:
//   1. Convert (input, output, model) → USD via a model price table.
//   2. Resolve the per-agent USD ceiling that the watchdog enforces.
//
// Pricing rates mirror the Sonnet-only constants in
// platform-ops.service.ts:91-92 — kept inline here (rather than extracted
// into a shared pricing service) until a third consumer needs them.

export interface ModelPricing {
  input: number;   // USD per token
  output: number;  // USD per token
}

// Public list-prices in USD per token (USD per million ÷ 1_000_000), as of
// 2026-04. Each Bedrock variant maps to the same family rate. The 'default'
// row is a safe fallback so an unknown model never trips a hard kill from
// undefined math.
export const MODEL_PRICING_USD_PER_TOKEN: Record<string, ModelPricing> = {
  // Anthropic Claude direct model IDs
  'claude-sonnet-4-6':                    { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
  'claude-opus-4-6':                      { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-opus-4-7':                      { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-haiku-4-5-20251001':            { input: 1 / 1_000_000,  output: 5 / 1_000_000 },

  // Bedrock-prefixed variants
  'us.anthropic.claude-sonnet-4-20250514-v1:0':   { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0':  { input: 1 / 1_000_000,  output: 5 / 1_000_000 },

  // Other providers (rough public rates — refine when/if real bills land)
  'gpt-5.4':                              { input: 5 / 1_000_000,  output: 15 / 1_000_000 },
  'gemini-2.5-flash':                     { input: 0.10 / 1_000_000, output: 0.30 / 1_000_000 },

  // Conservative fallback — assume mid-tier rates so unknown models can't
  // cost-bypass the ceiling silently.
  'default':                              { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
};

export function computeCostUsd(inputTokens: number, outputTokens: number, model: string): number {
  const rate = MODEL_PRICING_USD_PER_TOKEN[model] ?? MODEL_PRICING_USD_PER_TOKEN['default'];
  return inputTokens * rate.input + outputTokens * rate.output;
}

// Per-agent USD ceiling — backstop against runaway runs. Sized roughly:
//   - Engineering: longest tool-call chains on Sonnet, file generation
//   - Browser: Browserbase per-minute on top of LLM tokens
//   - Research / Data: shorter chains, fewer giant payloads
//   - Support / Twitter / MetaAds / ColdOutreach: short, structured runs
//   - CEO chat: 5-turn reactive ceiling on Opus
const AGENT_COST_CEILINGS_USD: Record<number, number> = {
  0:  0.20,  // CEO/chat (Opus, 5 turns reactive)
  29: 0.50,  // Research
  30: 1.50,  // Engineering
  32: 0.30,  // Support
  33: 0.50,  // Data
  40: 0.30,  // Twitter
  41: 0.30,  // MetaAds
  42: 1.00,  // Browser (Browserbase + LLM)
  54: 0.30,  // ColdOutreach
};

const DEFAULT_AGENT_COST_CEILING_USD = 0.50;

export function getCostCeilingForAgent(agentId: number): number {
  return AGENT_COST_CEILINGS_USD[agentId] ?? DEFAULT_AGENT_COST_CEILING_USD;
}
