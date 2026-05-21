// callBigLLM — high-tier sibling of callSmallLLM.
// Used by onboarding stages that produce founder-facing strategic artifacts
// (market research, mission, final starter tasks) where reasoning quality
// matters more than per-call cost. Mirrors small-llm.ts structure, but
// upgrades the model in each provider lane:
//   Anthropic: Opus 4.6   (vs Haiku 4.5 in small-llm)
//   OpenAI:    GPT-5.4    (vs GPT-5.4-mini)
//   Gemini:    2.5-pro    (vs 2.5-flash)
//
// Provider fallback order respects PRIMARY_LLM_PROVIDER env, same as small-llm.
// Auto-records LLM cost via AsyncLocalStorage when called inside an onboarding stage.

import { onboardingContext } from '../context';
import { recordLLMCall } from '../shared/cost-tracker';

export const BIG_LLM_FALLBACK_MODEL = 'claude-opus-4-6';

export async function callBigLLM(prompt: string, maxTokens = 3000): Promise<string> {
  const store = onboardingContext.getStore();
  if (store) recordLLMCall(store.ctx, store.stage, maxTokens);

  const { isAnthropicAvailable, isOpenAIAvailable, callOpenAI, OPENAI_MODELS, getPreferredProvider } = await import('@/lib/llm-provider');

  const preferred = getPreferredProvider();
  const order = preferred === 'anthropic'
    ? (['anthropic', 'openai', 'gemini'] as const)
    : (['openai', 'anthropic', 'gemini'] as const);

  for (const p of order) {
    try {
      if (p === 'openai' && isOpenAIAvailable()) {
        return await callOpenAI({ userPrompt: prompt, maxTokens, model: OPENAI_MODELS.GPT_5_4 });
      }
      if (p === 'anthropic' && isAnthropicAvailable()) {
        const { createAnthropicWithOAuthAsync, CLAUDE_CODE_IDENTITY } = await import('@/lib/anthropic-oauth');
        const { client, isOAuth } = await createAnthropicWithOAuthAsync();
        const response = await (isOAuth
          ? client.messages.create({
              model: BIG_LLM_FALLBACK_MODEL,
              max_tokens: maxTokens,
              system: [{ type: 'text', text: CLAUDE_CODE_IDENTITY }],
              messages: [{ role: 'user', content: prompt }],
            })
          : client.messages.create({
              model: BIG_LLM_FALLBACK_MODEL,
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }],
            }));
        const block = response.content[0];
        return block.type === 'text' ? block.text : '';
      }
      if (p === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'placeholder') continue;
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
        const result = await model.generateContent(prompt);
        return result.response.text();
      }
    } catch {
      // try next provider
    }
  }

  throw new Error('No big-tier LLM provider available (Anthropic Opus, OpenAI GPT-5.4, and Gemini 2.5 Pro all unavailable)');
}
