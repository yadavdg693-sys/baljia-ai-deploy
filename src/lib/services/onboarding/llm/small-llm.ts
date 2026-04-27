// callSmallLLM — renamed from callHaiku (reflects actual routing to Codex GPT-5.4 primary)
// Provider-ordered fallback: OpenAI → Anthropic → Gemini (respects PRIMARY_LLM_PROVIDER env)
// Auto-records LLM cost via AsyncLocalStorage when called inside an onboarding stage.

import Anthropic from '@anthropic-ai/sdk';
import { onboardingContext } from '../context';
import { recordLLMCall } from '../shared/cost-tracker';

export const SMALL_LLM_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

export async function callSmallLLM(prompt: string, maxTokens = 256): Promise<string> {
  // Auto-record cost if we're inside an onboarding stage (ALS populated by stage-runner)
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
        return await callOpenAI({ userPrompt: prompt, maxTokens, model: OPENAI_MODELS.GPT_5_4_MINI });
      }
      if (p === 'anthropic' && isAnthropicAvailable()) {
        const { createAnthropicWithOAuth, CLAUDE_CODE_IDENTITY } = await import('@/lib/anthropic-oauth');
        const { client, isOAuth } = createAnthropicWithOAuth();
        // OAuth requires the Claude Code identity as the first system block.
        // Non-OAuth path skips system entirely (matches prior behavior).
        const response = await (isOAuth
          ? client.messages.create({
              model: SMALL_LLM_FALLBACK_MODEL,
              max_tokens: maxTokens,
              system: [{ type: 'text', text: CLAUDE_CODE_IDENTITY }],
              messages: [{ role: 'user', content: prompt }],
            })
          : client.messages.create({
              model: SMALL_LLM_FALLBACK_MODEL,
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
