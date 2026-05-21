# Skill: OpenAI Proxy — Embeddings, Image Generation, OCR

**READ THIS BEFORE writing any embedding, image generation, or OCR code.**

All AI calls in Baljia founder/user apps use the platform-managed Gemini provider. You NEVER need a user's own OpenAI API key. The platform injects the Google OpenAI-compatible endpoint and Gemini key into Render.

---

## Architecture

```
Your app code
    ↓
lib/ai.ts  (pre-wired in skeleton)
    ↓
AI_GATEWAY_URL  (https://generativelanguage.googleapis.com/v1beta/openai)
    ↓
Google Gemini OpenAI-compatible API
```

The gateway is OpenAI-API-compatible. Any SDK or library that accepts a `baseURL` and `apiKey` override works with it, but founder runtime model names must be Gemini model names.

---

## Setup (skeleton apps)

Already pre-wired in `lib/ai.ts`. Import from there — never instantiate directly.

```typescript
// ✅ Always do this in skeleton apps
import { openai, anthropic } from '@/lib/ai';

// ❌ Never do this — breaks billing and requires user's key
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

---

## Embeddings

Use for: semantic search, similarity matching, RAG (retrieval-augmented generation), clustering.

```typescript
import { openai } from '@/lib/ai';

export const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_DIMS = Number(process.env.AI_EMBEDDING_DIMENSIONS || 3072);

// Single text embedding
export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.trim(),
  });
  return response.data[0].embedding;
}

// Batch embedding (more efficient)
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map(t => t.trim()),
  });
  return response.data.map(d => d.embedding);
}

// Cosine similarity helper
export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dot / (magA * magB);
}
```

### Storing embeddings in Postgres

```sql
-- Add pgvector extension (run via run_migration)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to your table.
-- Founder/user apps use Gemini embeddings on the Google OpenAI-compatible gateway.
-- Use vector(3072) for gemini-embedding-001.
ALTER TABLE documents ADD COLUMN embedding vector(3072);

-- Do NOT create ivfflat/hnsw indexes on vector(3072); pgvector vector indexes
-- support <=2000 dimensions. For small founder/canary data, exact ORDER BY is
-- fine. If you need an ANN index, use a <=2000-dim representation or halfvec.
```

```typescript
// Store embedding
await db.execute(sql`
  UPDATE documents
  SET embedding = ${JSON.stringify(embedding)}::vector
  WHERE id = ${docId}
`);

// Semantic search — find 5 most similar
const results = await db.execute(sql`
  SELECT id, title, content,
         1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
  FROM documents
  WHERE user_id = ${userId}
  ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
  LIMIT 5
`);
```

---

## Image Generation

Use for: generating product mockups, AI art, marketing assets.

```typescript
import { openai } from '@/lib/ai';

export async function generateImage(prompt: string): Promise<string> {
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',    // '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792'
    quality: 'standard',  // 'standard' | 'hd'
    response_format: 'url',
  });

  const url = response.data[0].url;
  if (!url) throw new Error('Image generation returned no URL');
  return url;
}

// Generate and immediately upload to R2 for persistence
// (Dall-E URLs expire after ~1 hour — always persist to R2)
export async function generateAndStore(prompt: string, key: string): Promise<string> {
  const tempUrl = await generateImage(prompt);

  // Download the image
  const imageRes = await fetch(tempUrl);
  const buffer = Buffer.from(await imageRes.arrayBuffer());

  // Upload to R2 via your r2-proxy
  const r2Url = await uploadToR2(buffer, key, 'image/png');
  return r2Url;
}
```

> **Critical**: OpenAI image URLs expire in ~1 hour. Always upload to R2 immediately after generation. See `r2-storage` skill.

---

## OCR / Document Processing

Use for: extracting text from PDFs, images, scanned documents.

```typescript
import { openai } from '@/lib/ai';

// Extract text from an image URL
export async function ocrImageUrl(imageUrl: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',   // Vision-capable model
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageUrl, detail: 'high' },
          },
          {
            type: 'text',
            text: 'Extract ALL text from this image exactly as it appears. Return only the extracted text, no commentary.',
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  return response.choices[0].message.content ?? '';
}

// Extract text from a base64 image (e.g., uploaded file)
export async function ocrBase64Image(base64: string, mimeType: 'image/png' | 'image/jpeg'): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: 'Extract ALL text from this image exactly as it appears. Return only the extracted text.',
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  return response.choices[0].message.content ?? '';
}
```

---

## Text Generation (chat completions)

For structured output or simple generation tasks not requiring the full Anthropic SDK:

```typescript
import { openai } from '@/lib/ai';

const isGoogleGateway = process.env.AI_GATEWAY_URL?.includes('generativelanguage.googleapis.com');
if (!isGoogleGateway) {
  throw new Error('Founder AI apps must use the Gemini OpenAI-compatible gateway.');
}
const CHAT_MODEL = process.env.AI_TEXT_MODEL || 'gemini-2.5-flash';

// Simple generation
export async function generateText(prompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
  });
  return response.choices[0].message.content ?? '';
}

// Structured JSON output
export async function generateJSON<T>(prompt: string, schema: string): Promise<T> {
  const response = await openai.chat.completions.create({
    model: process.env.AI_JSON_MODEL || CHAT_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `You are a JSON API. Return valid JSON matching this schema: ${schema}` },
      { role: 'user', content: prompt },
    ],
  });
  return JSON.parse(response.choices[0].message.content ?? '{}') as T;
}
```

---

## Model selection guide

| Task | Model | Why |
|---|---|---|
| Long-form writing, reasoning | `claude-sonnet-4-6` (via anthropic) | Best quality |
| Structured JSON, classification | `AI_JSON_MODEL` or `gemini-2.5-flash` | Fixed founder-app Gemini provider |
| Fast utility tasks | `AI_TEXT_MODEL` or `gemini-2.5-flash` | Fixed founder-app Gemini provider |
| Embeddings | `AI_EMBEDDING_MODEL` or `gemini-embedding-001` | Google OpenAI-compatible gateway returns 3072 dimensions |
| Image generation | `dall-e-3` | Best quality |
| OCR / vision | `gpt-4o` | Vision support |

Founder/user apps must use `AI_GATEWAY_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_TEXT_MODEL=gemini-2.5-flash`, and `AI_EMBEDDING_MODEL=gemini-embedding-001`. Do not use OpenAI model names such as `gpt-4o-mini` in founder runtime apps.

---

## Error handling

```typescript
import { openai } from '@/lib/ai';

export async function safeGenerate(prompt: string): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: process.env.AI_TEXT_MODEL || 'gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    });
    return response.choices[0].message.content;
  } catch (err) {
    // Gateway errors: 429 = rate limit, 503 = upstream down
    const status = (err as { status?: number }).status;
    if (status === 429) {
      console.error('AI rate limit hit — retry after 30s');
      return null;
    }
    if (status === 503) {
      console.error('AI gateway temporarily unavailable');
      return null;
    }
    throw err;   // Unknown error — let it bubble up
  }
}
```

---

## Common pitfalls

- **Do NOT use `process.env.OPENAI_API_KEY` directly** — always import from `@/lib/ai`
- **Dall-E URLs expire** — always upload generated images to R2 within 30 seconds
- **Embeddings are vectors** — store as pgvector, not JSON text. Founder/user apps use `gemini-embedding-001` with `vector(3072)` on the Google OpenAI-compatible gateway. Do not create ivfflat/hnsw indexes on `vector(3072)`; exact scan is fine for small datasets.
- **OCR with PDFs** — convert to images first (use a PDF-to-image library), then pass each page to `ocrBase64Image`
- **Token limits** — keep Gemini 2 Flash calls bounded with `max_tokens` and chunk long documents before summarizing
