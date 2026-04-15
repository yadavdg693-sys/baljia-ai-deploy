// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
// Marketing Agent Tools — Multi-platform content generation, scheduling, analytics
// Extends the existing Twitter agent with LinkedIn, Reddit, Product Hunt capabilities
// Uses MarketingService for persistence and AI generation
//
// INTEGRATION: LinkedIn API, Reddit API, Product Hunt API (via OAuth per platform)
// Platform connections stored in social_connections table

import type { Task } from '@/types';
import { MarketingService } from '@/lib/services/marketing.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('Marketing');

// ══════════════════════════════════════════════
// TOOL DEFINITIONS
// ══════════════════════════════════════════════

export function getMarketingTools() {
  return [
    {
      name: 'generate_social_post',
      description: 'Generate a social media post using AI for a specific platform. Respects platform-specific rules (character limits, tone, formatting). Returns draft content for review.',
      input_schema: {
        type: 'object' as const,
        properties: {
          platform: {
            type: 'string' as const,
            enum: ['linkedin', 'twitter', 'reddit', 'producthunt'],
            description: 'Target platform',
          },
          topic: { type: 'string' as const, description: 'What the post should be about' },
          tone: {
            type: 'string' as const,
            enum: ['technical', 'visionary', 'relatable', 'warm'],
            description: 'Brand voice tone (default: technical)',
          },
          post_type: {
            type: 'string' as const,
            enum: ['single', 'thread', 'article', 'discussion'],
            description: 'Type of post (default: single)',
          },
        },
        required: ['platform', 'topic'],
      },
    },
    {
      name: 'generate_thread',
      description: 'Generate a multi-part X/Twitter thread. Returns an array of tweet parts.',
      input_schema: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string' as const, description: 'Thread topic' },
          tone: {
            type: 'string' as const,
            enum: ['technical', 'visionary', 'relatable', 'warm'],
            description: 'Brand voice tone',
          },
          thread_length: {
            type: 'number' as const,
            description: 'Number of tweets in the thread (default: 6)',
          },
        },
        required: ['topic'],
      },
    },
    {
      name: 'generate_content_calendar',
      description: 'Generate a full content calendar for multiple weeks and platforms. Creates draft posts with suggested dates and topics based on the narrative arc phase.',
      input_schema: {
        type: 'object' as const,
        properties: {
          weeks: { type: 'number' as const, description: 'Number of weeks to plan (1-4)' },
          platforms: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Platforms to include: linkedin, twitter, reddit, producthunt',
          },
          tone: { type: 'string' as const, description: 'Brand voice tone' },
          phase: {
            type: 'string' as const,
            enum: ['problem', 'architecture', 'proof', 'invitation'],
            description: 'Narrative arc phase for content theming',
          },
        },
        required: ['weeks', 'platforms'],
      },
    },
    {
      name: 'schedule_social_post',
      description: 'Schedule a post for publishing at a specific time. The post must already exist as a draft.',
      input_schema: {
        type: 'object' as const,
        properties: {
          post_id: { type: 'string' as const, description: 'ID of the draft post to schedule' },
          scheduled_for: { type: 'string' as const, description: 'ISO timestamp for when to publish' },
        },
        required: ['post_id', 'scheduled_for'],
      },
    },
    {
      name: 'publish_social_post',
      description: 'Immediately publish a post to its platform. Requires an active OAuth connection for the target platform.',
      input_schema: {
        type: 'object' as const,
        properties: {
          post_id: { type: 'string' as const, description: 'ID of the post to publish' },
        },
        required: ['post_id'],
      },
    },
    {
      name: 'create_social_post',
      description: 'Create a new social media post (draft or scheduled). Use this to save content that was manually written or edited.',
      input_schema: {
        type: 'object' as const,
        properties: {
          platform: {
            type: 'string' as const,
            enum: ['linkedin', 'twitter', 'reddit', 'producthunt'],
            description: 'Target platform',
          },
          post_type: {
            type: 'string' as const,
            enum: ['single', 'thread', 'article', 'discussion'],
            description: 'Type of post',
          },
          title: { type: 'string' as const, description: 'Post title (required for Reddit/articles)' },
          content: { type: 'string' as const, description: 'Post content' },
          thread_parts: {
            type: 'array' as const,
            items: { type: 'object' as const },
            description: 'Thread parts for X threads: [{order: 1, text: "..."}]',
          },
          hashtags: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Hashtags to include',
          },
          campaign_tag: { type: 'string' as const, description: 'Campaign grouping tag' },
          phase: { type: 'string' as const, description: 'Narrative arc phase' },
          scheduled_for: { type: 'string' as const, description: 'ISO timestamp to schedule (omit for draft)' },
        },
        required: ['platform', 'post_type', 'content'],
      },
    },
    {
      name: 'get_marketing_posts',
      description: 'List marketing posts for this company. Can filter by platform and status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string' as const, description: 'Filter by platform' },
          status: {
            type: 'string' as const,
            enum: ['draft', 'scheduled', 'posted', 'failed'],
            description: 'Filter by status',
          },
          limit: { type: 'number' as const, description: 'Number of posts to return (default: 20)' },
        },
      },
    },
    {
      name: 'get_marketing_analytics',
      description: 'Get engagement analytics summary across all platforms. Shows impressions, engagement, top posts.',
      input_schema: {
        type: 'object' as const,
        properties: {
          days: { type: 'number' as const, description: 'Look back period in days (default: 7)' },
        },
      },
    },
    {
      name: 'get_engagement_queue',
      description: 'Get posts from other accounts that are relevant to engage with (reply, comment, quote-tweet). Returns suggested replies.',
      input_schema: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string' as const, description: 'Filter by platform (optional)' },
        },
      },
    },
    {
      name: 'generate_engagement_reply',
      description: 'Generate an AI-suggested reply for an engagement queue item.',
      input_schema: {
        type: 'object' as const,
        properties: {
          queue_item_id: { type: 'string' as const, description: 'Engagement queue item ID' },
        },
        required: ['queue_item_id'],
      },
    },
    {
      name: 'get_social_connections',
      description: 'Check which social platforms are connected with valid OAuth tokens.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'create_marketing_campaign',
      description: 'Create a marketing campaign to group related posts. Campaigns have a phase, tone, target audience, and content pillars.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Campaign name' },
          description: { type: 'string' as const, description: 'Campaign description' },
          phase: {
            type: 'string' as const,
            enum: ['problem', 'architecture', 'proof', 'invitation'],
            description: 'Narrative arc phase',
          },
          platforms: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Target platforms',
          },
          tone: { type: 'string' as const, description: 'Brand voice tone' },
          target_audience: { type: 'string' as const, description: 'Who this campaign targets' },
          content_pillars: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Content themes: build_in_public, technical_deep_dives, founder_pain, etc.',
          },
          start_date: { type: 'string' as const, description: 'Campaign start date (YYYY-MM-DD)' },
          end_date: { type: 'string' as const, description: 'Campaign end date (YYYY-MM-DD)' },
        },
        required: ['name'],
      },
    },
  ];
}

// ══════════════════════════════════════════════
// TOOL HANDLER
// ══════════════════════════════════════════════

export async function handleMarketingTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {
  const companyId = task.company_id;

  switch (toolName) {
    // ── Content Generation ──────────────────────
    case 'generate_social_post': {
      const platform = input.platform as string;
      const topic = input.topic as string;
      const tone = (input.tone as string) || 'technical';
      const postType = (input.post_type as string) || 'single';

      log.info(`Generating ${postType} for ${platform}: "${topic}"`);

      const result = await MarketingService.generatePost(companyId, platform, topic, tone, postType);
      return JSON.stringify({
        success: true,
        platform,
        post_type: postType,
        content: result.content,
        post_id: result.id,
        status: 'draft',
        message: `Generated ${postType} post for ${platform}. Status: draft. Use schedule_social_post or publish_social_post to publish.`,
      });
    }

    case 'generate_thread': {
      const topic = input.topic as string;
      const tone = (input.tone as string) || 'technical';
      const threadLength = (input.thread_length as number) || 6;

      log.info(`Generating ${threadLength}-part thread: "${topic}"`);

      const result = await MarketingService.generateThread(companyId, topic, tone, threadLength);
      return JSON.stringify({
        success: true,
        thread_parts: result.thread_parts,
        post_id: result.id,
        status: 'draft',
        message: `Generated ${threadLength}-part thread. Status: draft.`,
      });
    }

    case 'generate_content_calendar': {
      const weeks = (input.weeks as number) || 1;
      const platforms = (input.platforms as string[]) || ['linkedin', 'twitter'];
      const tone = (input.tone as string) || 'technical';
      const phase = (input.phase as string) || 'problem';

      log.info(`Generating ${weeks}-week calendar for: ${platforms.join(', ')}`);

      const result = await MarketingService.generateContentCalendar(companyId, weeks, platforms, tone, phase);
      return JSON.stringify({
        success: true,
        weeks,
        platforms,
        phase,
        posts_created: result.length,
        posts: result.map((p: { id: string; platform: string; title: string; scheduled_for: string }) => ({
          id: p.id,
          platform: p.platform,
          title: p.title,
          scheduled_for: p.scheduled_for,
        })),
        message: `Created ${result.length} draft posts across ${platforms.length} platforms for ${weeks} week(s).`,
      });
    }

    // ── Post Management ─────────────────────────
    case 'create_social_post': {
      const data = {
        platform: input.platform as string,
        post_type: input.post_type as string,
        title: input.title as string | undefined,
        content: input.content as string,
        thread_parts: input.thread_parts as unknown,
        hashtags: input.hashtags as string[] | undefined,
        campaign_tag: input.campaign_tag as string | undefined,
        phase: input.phase as string | undefined,
        scheduled_for: input.scheduled_for ? new Date(input.scheduled_for as string) : undefined,
      };

      const status = data.scheduled_for ? 'scheduled' : 'draft';
      const post = await MarketingService.createPost(companyId, { ...data, status });
      return JSON.stringify({
        success: true,
        post_id: post.id,
        status,
        message: `Post created as ${status}${data.scheduled_for ? ` for ${data.scheduled_for}` : ''}.`,
      });
    }

    case 'schedule_social_post': {
      const postId = input.post_id as string;
      const scheduledFor = new Date(input.scheduled_for as string);

      await MarketingService.schedulePost(postId, scheduledFor);
      return JSON.stringify({
        success: true,
        post_id: postId,
        scheduled_for: scheduledFor.toISOString(),
        message: `Post scheduled for ${scheduledFor.toISOString()}.`,
      });
    }

    case 'publish_social_post': {
      const postId = input.post_id as string;
      const result = await MarketingService.publishPost(postId);
      return JSON.stringify({
        success: result.success,
        post_id: postId,
        message: result.message,
        external_url: result.external_url || null,
      });
    }

    case 'get_marketing_posts': {
      const filters: Record<string, unknown> = {};
      if (input.platform) filters.platform = input.platform;
      if (input.status) filters.status = input.status;
      if (input.limit) filters.limit = input.limit;

      const posts = await MarketingService.getPostsByCompany(companyId, filters);
      return JSON.stringify({
        success: true,
        count: posts.length,
        posts: posts.map((p: { id: string; platform: string; title: string; status: string; scheduled_for: string; content: string }) => ({
          id: p.id,
          platform: p.platform,
          title: p.title,
          status: p.status,
          scheduled_for: p.scheduled_for,
          content_preview: p.content?.substring(0, 100) + (p.content?.length > 100 ? '...' : ''),
        })),
      });
    }

    // ── Analytics ────────────────────────────────
    case 'get_marketing_analytics': {
      const days = (input.days as number) || 7;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const analytics = await MarketingService.getAnalyticsSummary(companyId, {
        startDate,
        endDate,
      });

      const topPosts = await MarketingService.getTopPosts(companyId, 5);

      return JSON.stringify({
        success: true,
        period: `Last ${days} days`,
        summary: analytics,
        top_posts: topPosts.map((p: { id: string; platform: string; title: string; impressions: number; engagement_rate: number }) => ({
          id: p.id,
          platform: p.platform,
          title: p.title,
          impressions: p.impressions,
          engagement_rate: p.engagement_rate,
        })),
      });
    }

    // ── Engagement ───────────────────────────────
    case 'get_engagement_queue': {
      const platform = input.platform as string | undefined;
      const queue = await MarketingService.getEngagementQueue(companyId, platform);
      return JSON.stringify({
        success: true,
        count: queue.length,
        items: queue.map((item: { id: string; platform: string; author_handle: string; post_snippet: string; relevance_score: number; suggested_reply: string }) => ({
          id: item.id,
          platform: item.platform,
          author: item.author_handle,
          snippet: item.post_snippet?.substring(0, 150),
          relevance: item.relevance_score,
          has_suggested_reply: !!item.suggested_reply,
        })),
      });
    }

    case 'generate_engagement_reply': {
      const queueItemId = input.queue_item_id as string;
      const reply = await MarketingService.generateReply(queueItemId);
      return JSON.stringify({
        success: true,
        queue_item_id: queueItemId,
        suggested_reply: reply,
        message: 'Reply generated. Review and approve before sending.',
      });
    }

    // ── Connections & Campaigns ──────────────────
    case 'get_social_connections': {
      const connections = await MarketingService.getConnections(companyId);
      return JSON.stringify({
        success: true,
        platforms: connections.map((c: { platform: string; status: string; account_name: string }) => ({
          platform: c.platform,
          status: c.status,
          account: c.account_name,
        })),
        message: connections.length === 0
          ? 'No platforms connected. Connect via the Marketing dashboard settings.'
          : `${connections.length} platform(s) connected.`,
      });
    }

    case 'create_marketing_campaign': {
      const campaign = await MarketingService.createCampaign(companyId, {
        name: input.name as string,
        description: input.description as string | undefined,
        phase: input.phase as string | undefined,
        platforms: input.platforms as string[] | undefined,
        tone: input.tone as string | undefined,
        target_audience: input.target_audience as string | undefined,
        content_pillars: input.content_pillars as string[] | undefined,
        start_date: input.start_date as string | undefined,
        end_date: input.end_date as string | undefined,
      });

      return JSON.stringify({
        success: true,
        campaign_id: campaign.id,
        name: campaign.name,
        message: `Campaign "${campaign.name}" created. Assign posts to it using the campaign_tag field.`,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown marketing tool: ${toolName}` });
  }
}
