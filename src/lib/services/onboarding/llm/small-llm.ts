// callSmallLLM — renamed from callHaiku (reflects actual routing to Codex GPT-5.4 primary)
// Provider-ordered fallback: OpenAI → Anthropic → Gemini (respects PRIMARY_LLM_PROVIDER env)

import Anthropic from '@anthropic-ai/sdk';

export const SMALL_LLM_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

export async function callSmallLLM(prompt: string, maxTokens = 256): Promise<string> {
  const { isAnthropicAvailable, isOpenAIAvailable, callOpenAI, OPENAI_MODELS, getPreferredProvider } = await import('@/lib/llm-provider');

  const preferred = getPreferredProvider();
  const order = preferred === 'anthropic'
    ? (['anthropic', 'openai', 'gemini'] as const)
    : (['openai', 'anthropic', 'gemini'] as const);

  for (const p of order) {
    try {
      if (p === 'openai' && isOpenAIAvailable()) {
        return await callOpenAI({ userPrompt: prompt, maxTokens, model: OPENAI_MODELS.GPT_5_4_MINI });
      }
      if (p === 'anthropic' && isAnthropicAvailable()) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: SMALL_LLM_FALLBACK_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        const block = response.content[0];
        return block.type === 'text' ? block.text : '';
      }
      if (p === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'placeholder') continue;
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        return result.response.text();
      }
    } catch {
      // try next provider
    }
  }

  throw new Error('No LLM provider available (OpenAI, Anthropic, and Gemini all unavailable)');
}
