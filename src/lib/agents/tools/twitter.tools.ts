// Twitter Agent Tools — Tweet composition + posting (Agent #40)
// Domain 2.4: post_tweet, get_account, dedup against recent tweets
// Voice: dark-humor/witty, no emojis, no hashtags, include website link
//
// INTEGRATION: Twitter API v2 via OAuth 1.0a (User Context)
// Env: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET

import type { Task } from '@/types';
import { db, platformEvents, companies } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const log = createLogger('Twitter');

// ══════════════════════════════════════════════
// TWITTER API v2 CLIENT
// ══════════════════════════════════════════════

const TWITTER_API_BASE = 'https://api.twitter.com/2';

function isTwitterConfigured(): boolean {
  return !!(
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_SECRET
  );
}

/**
 * Generate OAuth 1.0a signature for Twitter API v2.
 * Twitter v2 still requires OAuth 1.0a for user-context endpoints (posting tweets).
 */
function generateOAuthHeader(method: string, url: string, body?: Record<string, unknown>): string {
  const apiKey = process.env.TWITTER_API_KEY!;
  const apiSecret = process.env.TWITTER_API_SECRET!;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN!;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET!;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const params: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // Build signature base string
  const sortedParams = Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&');

  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  params.oauth_signature = signature;

  return 'OAuth ' + Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`
  ).join(', ');
}

async function twitterPost(text: string): Promise<{ id: string; text: string }> {
  const url = `${TWITTER_API_BASE}/tweets`;
  const body = { text };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: generateOAuthHeader('POST', url, body),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json() as { data?: { id: string; text: string }; errors?: Array<{ message: string }> };

  if (!response.ok || result.errors) {
    const errMsg = result.errors?.[0]?.message ?? `HTTP ${response.status}`;
    log.error('Twitter post failed', { status: response.status, error: errMsg });
    throw new Error(`Twitter API error: ${errMsg}`);
  }

  return result.data!;
}

async function twitterGetMe(): Promise<{ id: string; name: string; username: string }> {
  const url = `${TWITTER_API_BASE}/users/me`;

  const response = await fetch(url, {
    headers: { Authorization: generateOAuthHeader('GET', url) },
  });

  const result = await response.json() as { data?: { id: string; name: string; username: string } };
  if (!response.ok || !result.data) throw new Error('Failed to get Twitter account');
  return result.data;
}

async function twitterGetRecentTweets(userId: string, maxResults = 10): Promise<Array<{ id: string; text: string; created_at: string }>> {
  const url = `${TWITTER_API_BASE}/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at`;

  const response = await fetch(url, {
    headers: { Authorization: generateOAuthHeader('GET', url) },
  });

  const result = await response.json() as { data?: Array<{ id: string; text: string; created_at: string }> };
  return result.data ?? [];
}

// ══════════════════════════════════════════════
// TOOL DEFINITIONS
// ══════════════════════════════════════════════

export function getTwitterTools() {
  return [
    {
      name: 'post_tweet',
      description: 'Post a tweet from the company account. Max 280 characters. Follow voice rules: dark-humor/witty, no emojis, no hashtags, no filler words.',
      input_schema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' as const, description: 'Tweet text (max 280 chars)' },
          include_link: { type: 'boolean' as const, description: 'Append website link (default: true)' },
        },
        required: ['text'],
      },
    },
    {
      name: 'get_twitter_account',
      description: 'Get the connected Twitter account info and recent tweet history for dedup.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_recent_tweets',
      description: 'Get recent tweets posted by this company for deduplication. Always check before posting.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Number of recent tweets to retrieve (default: 10)' },
        },
      },
    },
    {
      name: 'schedule_tweet',
      description: 'Schedule a tweet for a future time.',
      input_schema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' as const, description: 'Tweet text (max 280 chars)' },
          scheduled_for: { type: 'string' as const, description: 'ISO timestamp for when to post' },
        },
        required: ['text', 'scheduled_for'],
      },
    },
  ];
}

// ══════════════════════════════════════════════
// TOOL HANDLER
// ══════════════════════════════════════════════

export async function handleTwitterTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {


  switch (toolName) {
    case 'post_tweet': {
      const text = (input.text as string).trim();

      // Validation
      if (text.length > 280) return `Tweet too long: ${text.length}/280 characters. Shorten it.`;
      if (/[😀-🙏🌀-🗿🚀-🛿🤀-🧿❤️✨🔥💯🎉🎊👏]/u.test(text)) {
        return 'Tweet contains emojis. Remove them — company voice rules prohibit emojis.';
      }
      if (/#\w+/.test(text)) return 'Tweet contains hashtags. Remove them — company voice rules prohibit hashtags.';

      // H-LOGIC-005: Dedup against tweet_posted events (not task_completed noise)
      const recent = await db.select({ payload: platformEvents.payload })
        .from(platformEvents)
        .where(and(
          eq(platformEvents.company_id, task.company_id),
          eq(platformEvents.event_type, 'task_completed'),
        ))
        .orderBy(desc(platformEvents.created_at)).limit(50);

      const recentTexts = (recent ?? [])
        .map((e) => (e.payload as Record<string, unknown>))
        .filter((p) => p?.type === 'tweet_posted')
        .map((p) => p?.tweet_text as string)
        .filter(Boolean);

      const isDuplicate = recentTexts.some((t) =>
        t && (t === text || t.toLowerCase().includes(text.toLowerCase().substring(0, 50)))
      );

      if (isDuplicate) return 'This tweet is too similar to a recent tweet. Write a fresh one.';

      // Get company slug for link
      const [company] = await db.select({ slug: companies.slug, custom_domain: companies.custom_domain, subdomain: companies.subdomain })
        .from(companies).where(eq(companies.id, task.company_id)).limit(1);

      let finalText = text;
      if (input.include_link !== false && company) {
        const domain = company.custom_domain ?? `${company.subdomain ?? company.slug}.baljia.com`;
        if (!finalText.includes(domain)) {
          finalText += `\n\n${domain}`;
        }
      }

      // Log to DB regardless
      await db.insert(platformEvents).values({
        company_id: task.company_id, event_type: 'task_completed',
        payload: { type: 'tweet_posted', tweet_text: finalText, task_id: task.id },
        is_public_safe: true,
      });

      // POST TO TWITTER API if configured
      if (isTwitterConfigured()) {
        try {
          const tweet = await twitterPost(finalText);
          log.info('Tweet posted to Twitter', { tweetId: tweet.id, companyId: task.company_id });
          return `✅ Tweet posted (ID: ${tweet.id}, ${finalText.length} chars): "${finalText}"`;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          log.error('Tweet failed to post', { companyId: task.company_id, error: msg });
          return `Tweet saved but failed to post to Twitter: ${msg}\nText: "${finalText}"`;
        }
      }

      return `Tweet queued (${finalText.length} chars): "${finalText}"\nNote: Connect Twitter API keys to enable auto-posting.`;
    }

    case 'get_twitter_account': {
      if (isTwitterConfigured()) {
        try {
          const me = await twitterGetMe();
          return `Twitter account connected:\n- Name: ${me.name}\n- Handle: @${me.username}\n- ID: ${me.id}\n- OAuth: Connected ✅`;
        } catch (error) {
          return `Twitter OAuth configured but API call failed: ${error instanceof Error ? error.message : 'Unknown'}`;
        }
      }

      const [company] = await db.select({ name: companies.name, slug: companies.slug })
        .from(companies).where(eq(companies.id, task.company_id)).limit(1);

      return `Twitter account for ${company?.name ?? 'company'}:\n- Handle: @${company?.slug ?? 'unknown'}\n- OAuth: NOT connected — set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET`;
    }

    case 'get_recent_tweets': {
      const limit = Math.min((input.limit as number) ?? 10, 20);

      // Try real Twitter API first
      if (isTwitterConfigured()) {
        try {
          const me = await twitterGetMe();
          const tweets = await twitterGetRecentTweets(me.id, limit);
          if (!tweets.length) return 'No recent tweets found on Twitter.';
          return `Recent tweets from @${me.username}:\n${tweets.map(t => `- ${t.text} (${t.created_at})`).join('\n')}`;
        } catch {
          log.warn('Twitter API fetch failed, falling back to DB');
        }
      }

      // Fallback: DB records
      const data = await db.select({ payload: platformEvents.payload, created_at: platformEvents.created_at })
        .from(platformEvents)
        .where(and(eq(platformEvents.company_id, task.company_id), eq(platformEvents.event_type, 'task_completed')))
        .orderBy(desc(platformEvents.created_at)).limit(limit);

      const tweets = (data ?? [])
        .filter((e) => (e.payload as Record<string, unknown>)?.type === 'tweet_posted')
        .map((e) => `- ${(e.payload as Record<string, unknown>)?.tweet_text} (${e.created_at})`);

      return tweets.length ? `Recent tweets (from DB):\n${tweets.join('\n')}` : 'No recent tweets found.';
    }

    case 'schedule_tweet': {
      // Save to DB for cron-based publishing
      await db.insert(platformEvents).values({
        company_id: task.company_id, event_type: 'tweet_scheduled',
        payload: { text: input.text, scheduled_for: input.scheduled_for, task_id: task.id },
        is_public_safe: false,
      });

      return `Tweet scheduled for ${input.scheduled_for}: "${input.text}"\nSaved to queue for cron-based publishing.`;
    }

    default:
      return `Unknown twitter tool: ${toolName}`;
  }
}
