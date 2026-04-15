// LLM Provider — determines which provider to use based on available API keys
// Fallback chain: Anthropic → OpenRouter → Gemini
// OpenRouter provides access to GLM-4 and Qwen models via OpenAI-compatible API

export function isAnthropicAvailable(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && key !== 'placeholder' && key.startsWith('sk-ant-');
}

export function isOpenRouterAvailable(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return !!key && key !== 'placeholder';
}

export function isGeminiAvailable(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return !!key && key !== 'placeholder';
}

// OpenRouter model IDs
export const OPENROUTER_MODELS = {
  GLM_5_1: 'z-ai/glm-5.1',               // GLM 5.1 (Z.ai / Zhipu) — #1 SWE-Bench Pro, agentic coding
  QWEN_3_6_PLUS: 'qwen/qwen3.6-plus',    // Qwen 3.6 Plus (Alibaba) — 1M context, hybrid MoE
  // Defaults per execution mode
  FULL_AGENT: 'z-ai/glm-5.1',            // Best for complex agentic tasks (8hr sustained execution)
  TEMPLATE: 'qwen/qwen3.6-plus',          // Strong reasoning for template customization
  DETERMINISTIC: 'qwen/qwen3.6-plus',     // Fast for mechanical tasks
} as const;

export function getPreferredProvider(): 'anthropic' | 'openrouter' | 'gemini' {
  if (isAnthropicAvailable()) return 'anthropic';
  if (isOpenRouterAvailable()) return 'openrouter';
  if (isGeminiAvailable()) return 'gemini';
  return 'gemini'; // will fail with clear error
}
