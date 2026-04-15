// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
import { db, marketingPosts, postAnalytics, marketingCampaigns, engagementQueue, socialConnections } from '@/lib/db';
import { eq, and, desc, asc, like, inArray, gte, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export interface PostFilters {
  platform?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface CampaignFilters {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface AnalyticsDateRange {
  startDate?: string;
  endDate?: string;
}

/**
 * Get posts for a company with optional filtering
 */
export async function getPostsByCompany(companyId: string, filters: PostFilters = {}) {
  const { platform, status, limit = 50, offset = 0 } = filters;

  const conditions = [eq(marketingPosts.company_id, companyId)];

  if (platform) {
    conditions.push(eq(marketingPosts.platform, platform));
  }

  if (status) {
    conditions.push(eq(marketingPosts.status, status));
  }

  const posts = await db.select()
    .from(marketingPosts)
    .where(and(...conditions))
    .orderBy(desc(marketingPosts.created_at))
    .limit(limit)
    .offset(offset);

  return posts;
}

/**
 * Get single post with its analytics
 */
export async function getPostWithAnalytics(postId: string) {
  const [post] = await db.select()
    .from(marketingPosts)
    .where(eq(marketingPosts.id, postId))
    .limit(1);

  if (!post) return null;

  const analytics = await db.select()
    .from(postAnalytics)
    .where(eq(postAnalytics.post_id, postId))
    .orderBy(desc(postAnalytics.fetched_at))
    .limit(1);

  return {
    ...post,
    analytics: analytics[0] || null,
  };
}

/**
 * Create a new post
 */
export async function createPost(data: {
  company_id: string;
  platform: string;
  post_type: string;
  content: string;
  title?: string;
  scheduled_for?: Date;
  campaign_tag?: string;
  phase?: string;
  thread_parts?: any;
  media_urls?: any;
  hashtags?: any;
  ai_generated?: boolean;
  ai_prompt?: string;
  task_id?: string;
}) {
  const [post] = await db.insert(marketingPosts)
    .values({
      company_id: data.company_id,
      platform: data.platform,
      post_type: data.post_type,
      content: data.content,
      title: data.title,
      scheduled_for: data.scheduled_for,
      campaign_tag: data.campaign_tag,
      phase: data.phase,
      thread_parts: data.thread_parts,
      media_urls: data.media_urls,
      hashtags: data.hashtags,
      ai_generated: data.ai_generated || false,
      ai_prompt: data.ai_prompt,
      task_id: data.task_id,
      status: 'draft',
    })
    .returning();

  return post;
}

/**
 * Update a post
 */
export async function updatePost(postId: string, data: Partial<{
  platform: string;
  post_type: string;
  content: string;
  title: string;
  scheduled_for: Date | null;
  campaign_tag: string;
  phase: string;
  thread_parts: any;
  media_urls: any;
  hashtags: any;
  status: string;
}>) {
  const updateData: any = { updated_at: new Date() };

  if (data.platform) updateData.platform = data.platform;
  if (data.post_type) updateData.post_type = data.post_type;
  if (data.content) updateData.content = data.content;
  if (data.title !== undefined) updateData.title = data.title;
  if (data.scheduled_for !== undefined) updateData.scheduled_for = data.scheduled_for;
  if (data.campaign_tag !== undefined) updateData.campaign_tag = data.campaign_tag;
  if (data.phase) updateData.phase = data.phase;
  if (data.thread_parts) updateData.thread_parts = data.thread_parts;
  if (data.media_urls) updateData.media_urls = data.media_urls;
  if (data.hashtags) updateData.hashtags = data.hashtags;
  if (data.status) updateData.status = data.status;

  const [updated] = await db.update(marketingPosts)
    .set(updateData)
    .where(eq(marketingPosts.id, postId))
    .returning();

  return updated;
}

/**
 * Delete a post
 */
export async function deletePost(postId: string) {
  await db.delete(marketingPosts).where(eq(marketingPosts.id, postId));
  return true;
}

/**
 * Publish a post (update status and set posted_at)
 */
export async function publishPost(postId: string, externalPostId?: string, externalUrl?: string) {
  const [updated] = await db.update(marketingPosts)
    .set({
      status: 'posted',
      posted_at: new Date(),
      external_post_id: externalPostId,
      external_url: externalUrl,
      updated_at: new Date(),
    })
    .where(eq(marketingPosts.id, postId))
    .returning();

  return updated;
}

/**
 * Get campaigns for a company
 */
export async function getCampaignsByCompany(companyId: string, filters: CampaignFilters = {}) {
  const { status, limit = 50, offset = 0 } = filters;

  const conditions = [eq(marketingCampaigns.company_id, companyId)];

  if (status) {
    conditions.push(eq(marketingCampaigns.status, status));
  }

  const campaigns = await db.select()
    .from(marketingCampaigns)
    .where(and(...conditions))
    .orderBy(desc(marketingCampaigns.created_at))
    .limit(limit)
    .offset(offset);

  return campaigns;
}

/**
 * Create a campaign
 */
export async function createCampaign(data: {
  company_id: string;
  name: string;
  description?: string;
  phase?: string;
  start_date?: Date;
  end_date?: Date;
  platforms?: any;
  tone?: string;
  target_audience?: string;
  content_pillars?: any;
}) {
  const [campaign] = await db.insert(marketingCampaigns)
    .values({
      company_id: data.company_id,
      name: data.name,
      description: data.description,
      phase: data.phase,
      start_date: data.start_date,
      end_date: data.end_date,
      platforms: data.platforms,
      tone: data.tone,
      target_audience: data.target_audience,
      content_pillars: data.content_pillars,
      status: 'draft',
    })
    .returning();

  return campaign;
}

/**
 * Get engagement queue items
 */
export async function getEngagementQueue(companyId: string, status?: string) {
  const conditions = [eq(engagementQueue.company_id, companyId)];

  if (status) {
    conditions.push(eq(engagementQueue.status, status));
  }

  const items = await db.select()
    .from(engagementQueue)
    .where(and(...conditions))
    .orderBy(desc(engagementQueue.created_at));

  return items;
}

/**
 * Add to engagement queue
 */
export async function addToEngagementQueue(data: {
  company_id: string;
  platform: string;
  external_post_url: string;
  author_name?: string;
  author_handle?: string;
  post_snippet?: string;
  relevance_score?: number;
  suggested_reply?: string;
}) {
  const [item] = await db.insert(engagementQueue)
    .values({
      company_id: data.company_id,
      platform: data.platform,
      external_post_url: data.external_post_url,
      author_name: data.author_name,
      author_handle: data.author_handle,
      post_snippet: data.post_snippet,
      relevance_score: data.relevance_score ? String(data.relevance_score) : undefined,
      suggested_reply: data.suggested_reply,
      status: 'pending',
    })
    .returning();

  return item;
}

/**
 * Get connected platforms for a company
 */
export async function getConnectedPlatforms(companyId: string) {
  const connections = await db.select()
    .from(socialConnections)
    .where(eq(socialConnections.company_id, companyId));

  return connections;
}

/**
 * Get specific connection
 */
export async function getConnection(companyId: string, platform: string) {
  const [connection] = await db.select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.company_id, companyId),
        eq(socialConnections.platform, platform)
      )
    )
    .limit(1);

  return connection;
}

/**
 * Save or update connection
 */
export async function saveConnection(data: {
  company_id: string;
  platform: string;
  account_name?: string;
  account_id?: string;
  access_token: string;
  refresh_token?: string;
  token_expires_at?: Date;
  scopes?: string;
  metadata?: any;
}) {
  const existing = await getConnection(data.company_id, data.platform);

  if (existing) {
    const [updated] = await db.update(socialConnections)
      .set({
        account_name: data.account_name,
        account_id: data.account_id,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_expires_at: data.token_expires_at,
        scopes: data.scopes,
        metadata: data.metadata,
        status: 'connected',
        updated_at: new Date(),
      })
      .where(
        and(
          eq(socialConnections.company_id, data.company_id),
          eq(socialConnections.platform, data.platform)
        )
      )
      .returning();

    return updated;
  }

  const [created] = await db.insert(socialConnections)
    .values({
      company_id: data.company_id,
      platform: data.platform,
      account_name: data.account_name,
      account_id: data.account_id,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.token_expires_at,
      scopes: data.scopes,
      metadata: data.metadata,
      status: 'connected',
    })
    .returning();

  return created;
}

/**
 * Remove connection
 */
export async function removeConnection(companyId: string, platform: string) {
  await db.delete(socialConnections)
    .where(
      and(
        eq(socialConnections.company_id, companyId),
        eq(socialConnections.platform, platform)
      )
    );

  return true;
}

/**
 * Get analytics summary for company
 */
export async function getAnalyticsSummary(companyId: string, dateRange?: AnalyticsDateRange) {
  const { startDate, endDate } = dateRange || {};

  // Get all posts for the company
  const posts = await db.select()
    .from(marketingPosts)
    .where(eq(marketingPosts.company_id, companyId));

  if (posts.length === 0) {
    return {
      total_posts: 0,
      total_impressions: 0,
      total_engagement: 0,
      avg_engagement_rate: 0,
      by_platform: {},
      by_status: {},
    };
  }

  const postIds = posts.map(p => p.id);

  // Get analytics for those posts
  const analyticsData = await db.select()
    .from(postAnalytics)
    .where(inArray(postAnalytics.post_id, postIds));

  const totalImpressions = analyticsData.reduce((sum, a) => sum + (a.impressions || 0), 0);
  const totalEngagement = analyticsData.reduce((sum, a) => sum + (a.likes || 0) + (a.comments || 0) + (a.shares || 0), 0);
  const avgEngagementRate = analyticsData.length > 0
    ? (analyticsData.reduce((sum, a) => sum + (parseFloat(a.engagement_rate as any) || 0), 0) / analyticsData.length)
    : 0;

  // Group by platform
  const byPlatform: Record<string, any> = {};
  posts.forEach(post => {
    if (!byPlatform[post.platform]) {
      byPlatform[post.platform] = { count: 0, impressions: 0, engagement: 0 };
    }
    byPlatform[post.platform].count++;

    const postAnalytics = analyticsData.find(a => a.post_id === post.id);
    if (postAnalytics) {
      byPlatform[post.platform].impressions += postAnalytics.impressions || 0;
      byPlatform[post.platform].engagement += (postAnalytics.likes || 0) + (postAnalytics.comments || 0) + (postAnalytics.shares || 0);
    }
  });

  // Group by status
  const byStatus: Record<string, number> = {};
  posts.forEach(post => {
    byStatus[post.status] = (byStatus[post.status] || 0) + 1;
  });

  return {
    total_posts: posts.length,
    total_impressions: totalImpressions,
    total_engagement: totalEngagement,
    avg_engagement_rate: Math.round(avgEngagementRate * 100) / 100,
    by_platform: byPlatform,
    by_status: byStatus,
  };
}

/**
 * Get posts scheduled for publishing (for cron job)
 */
export async function getScheduledPosts(beforeDate: Date) {
  const posts = await db.select()
    .from(marketingPosts)
    .where(
      and(
        eq(marketingPosts.status, 'scheduled'),
        lte(marketingPosts.scheduled_for, beforeDate)
      )
    )
    .orderBy(asc(marketingPosts.scheduled_for));

  return posts;
}

/**
 * Mark post as failed with error message
 */
export async function failPost(postId: string, errorMessage: string) {
  const [updated] = await db.update(marketingPosts)
    .set({
      status: 'failed',
      error_message: errorMessage,
      updated_at: new Date(),
    })
    .where(eq(marketingPosts.id, postId))
    .returning();

  return updated;
}

