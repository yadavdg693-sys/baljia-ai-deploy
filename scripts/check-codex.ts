import { isOpenAIAvailable, getOpenAIApiKey, getPreferredProvider, isAnthropicAvailable, isDirectAnthropicAvailable, isBedrockAvailable } from '@/lib/llm-provider';

console.log('BALJIA_OPENAI_OAUTH_STORE_PATH:', process.env.BALJIA_OPENAI_OAUTH_STORE_PATH);
console.log('');
console.log('isDirectAnthropicAvailable:', isDirectAnthropicAvailable());
console.log('isBedrockAvailable:        ', isBedrockAvailable());
console.log('isAnthropicAvailable:      ', isAnthropicAvailable());
console.log('isOpenAIAvailable (Codex): ', isOpenAIAvailable());
console.log('');
const key = getOpenAIApiKey();
console.log('Resolved OpenAI key present:', !!key);
console.log('key prefix:', key?.slice(0, 12) ?? 'null');
console.log('JWT?:', key?.startsWith('eyJ') ?? false);
console.log('');
console.log('getPreferredProvider:', getPreferredProvider());
process.exit(0);
