# agent-sdk — AI & Search for Founder Apps

**Read this BEFORE adding any LLM call, AI feature, or web search to a founder app.**

AI and search are **opt-in**. They are NOT included in every app by default.
Only add them when the founder explicitly requests an AI feature or search capability.

---

## When a Founder Asks for AI Features

### Step 1 — Add env vars to their Render service

Use `render_set_env_var` (or pass via `create_instance` `extraEnvVars`) to add:

```
AI_GATEWAY_URL   = https://generativelanguage.googleapis.com/v1beta/openai
AI_GATEWAY_TOKEN = <GEMINI_API_KEY from platform>
GEMINI_API_KEY   = <same key>
AI_TEXT_MODEL    = gemini-2.5-flash
AI_JSON_MODEL    = gemini-2.5-flash
AI_EMBEDDING_MODEL = gemini-embedding-001
AI_EMBEDDING_DIMENSIONS = 3072
```

These are **platform-managed keys** — the founder never sees or provides them.

### Step 2 — Use `lib/ai.ts` from the skeleton

The skeleton already has a pre-built client at `lib/ai.ts`. Import it directly:

```ts
import { openai, DEFAULT_MODEL } from '@/lib/ai';

// Text generation
const result = await openai.chat.completions.create({
  model: DEFAULT_MODEL,   // "gemini-2.5-flash"
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: userMessage },
  ],
  max_tokens: 1000,
});

const reply = result.choices[0].message.content;
```

### Step 3 — Always add timeout + fallback

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 25_000); // 25s max

try {
  const result = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [...],
    signal: controller.signal,
  });
  return result.choices[0].message.content;
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    return 'AI response took too long. Please try again.';
  }
  console.error('[ai] generation failed', err);
  return 'Something went wrong. Please try again.';
} finally {
  clearTimeout(timer);
}
```

---

## When a Founder Asks for Web Search

### Step 1 — Add Tavily env var to their Render service

```
TAVILY_API_KEY = <TAVILY_API_KEY from platform>
```

### Step 2 — Use the `tavilySearch` helper from `lib/ai.ts`

```ts
import { tavilySearch } from '@/lib/ai';

const { answer, results } = await tavilySearch("latest AI news", {
  maxResults: 5,
  searchDepth: "basic",
  includeAnswer: true,   // Tavily generates a summary answer
});

// results = [{ title, url, content, score }, ...]
```

### When to use each search depth:
| Depth | Speed | Use for |
|---|---|---|
| `basic` | Fast | Simple lookups, quick facts |
| `advanced` | Slower, more thorough | Research, comprehensive answers |

---

## Model Reference

| Model | Speed | Use for |
|---|---|---|
| `gemini-2.5-flash` | Fast | Default — most tasks |
| `gemini-2.5-pro` | Slower, smarter | Complex reasoning, long docs |
| `gemini-embedding-001` | Fast | Embeddings on Google `generativelanguage.googleapis.com/v1beta/openai` gateway; returns 3072 dimensions |

---

## What NOT to Do

| ❌ Wrong | ✅ Right |
|---|---|
| Hardcode `GEMINI_API_KEY` in code | Read from `process.env.AI_GATEWAY_TOKEN` |
| Add AI to every app by default | Only when founder requests it |
| Open-ended agent loop in v1 | Single, focused AI action |
| No timeout on model call | Always wrap with `AbortController` |
| No fallback message | Always return user-friendly error |
| Use `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Use `AI_GATEWAY_TOKEN` from the fixed Gemini provider env |

---

## Production Policy

Founder/user apps are pinned to the Gemini OpenAI-compatible endpoint. Do not switch these apps to `https://ai.baljia.app` while their runtime model is `gemini-2.5-flash`; that combination can return 404 and force fallback-only AI behavior.

```
AI_GATEWAY_URL   → https://generativelanguage.googleapis.com/v1beta/openai
AI_GATEWAY_TOKEN → <GEMINI_API_KEY from platform>
```
