// LLM Provider — determines which provider to use based on available API keys
// If ANTHROPIC_API_KEY is missing/placeholder, skip Claude entirely and use Gemini

export function isAnthropicAvailable(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && key !== 'placeholder' && key.startsWith('sk-ant-');
}

export function isGeminiAvailable(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return !!key && key !== 'placeholder';
}

export function getPreferredProvider(): 'anthropic' | 'gemini' {
  if (isAnthropicAvailable()) return 'anthropic';
  if (isGeminiAvailable()) return 'gemini';
  return 'gemini'; // will fail with clear error
}
