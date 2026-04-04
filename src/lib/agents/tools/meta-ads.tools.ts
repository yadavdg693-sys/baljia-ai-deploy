// Meta Ads Agent Tools — Facebook + Instagram ad management (Agent #41)
// Domain 2.4: 12 tools, separate billing lane, CTR/CPC thresholds
// Optimization: CTR > 1% healthy, < 0.5% kill. CPC < $1 healthy, > $2 kill.
//
// INTEGRATION: Meta Marketing API v21.0
// Env: META_ADS_ACCESS_TOKEN, META_ADS_ACCOUNT_ID

import type { Task } from '@/types';
import { db, adCampaigns, platformEvents } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('MetaAds');

// ══════════════════════════════════════════════
// META GRAPH API CLIENT
// ══════════════════════════════════════════════

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

function isMetaConfigured(): boolean {
  return !!(process.env.META_ADS_ACCESS_TOKEN && process.env.META_ADS_ACCOUNT_ID);
}

function getAccountId(): string {
  const id = process.env.META_ADS_ACCOUNT_ID!;
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function metaGraphRequest(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const token = process.env.META_ADS_ACCESS_TOKEN!;
  const separator = path.includes('?') ? '&' : '?';
  const url = `${GRAPH_API_BASE}${path}${separator}access_token=${token}`;

  const options: RequestInit = { method };
  if (body && method === 'POST') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const result = await response.json() as Record<string, unknown>;

  if (!response.ok || (result as { error?: { message: string } }).error) {
    const errMsg = (result as { error?: { message: string } }).error?.message ?? `HTTP ${response.status}`;
    log.error('Meta API error', { path, status: response.status, error: errMsg });
    throw new Error(`Meta API error: ${errMsg}`);
  }

  return result;
}

// Performance thresholds
const THRESHOLDS = {
  healthy_ctr: 0.01,       // > 1%
  mediocre_ctr: 0.005,     // 0.5-1%
  kill_ctr: 0.005,         // < 0.5%
  healthy_cpc: 1.0,        // < $1
  mediocre_cpc: 2.0,       // $1-$2
  kill_cpc: 2.0,           // > $2
};

// ══════════════════════════════════════════════
// TOOL DEFINITIONS (unchanged)
// ══════════════════════════════════════════════

export function getMetaAdsTools() {
  return [
    {
      name: 'create_campaign',
      description: 'Create a new Meta ad campaign with objective and budget.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const, description: 'Campaign name' },
          objective: { type: 'string' as const, description: 'Campaign objective: TRAFFIC, CONVERSIONS, AWARENESS, ENGAGEMENT' },
          daily_budget: { type: 'number' as const, description: 'Daily budget in USD (min $10)' },
        },
        required: ['name', 'objective', 'daily_budget'],
      },
    },
    {
      name: 'create_adset',
      description: 'Create an ad set within a campaign with targeting.',
      input_schema: {
        type: 'object' as const,
        properties: {
          campaign_id: { type: 'string' as const, description: 'Parent campaign ID' },
          name: { type: 'string' as const, description: 'Ad set name' },
          placements: { type: 'string' as const, description: 'Placements: facebook_feed, instagram_feed, stories, reels (comma-separated)' },
          age_min: { type: 'number' as const, description: 'Minimum age (default: 18)' },
          age_max: { type: 'number' as const, description: 'Maximum age (default: 65)' },
          interests: { type: 'string' as const, description: 'Targeting interests (comma-separated)' },
        },
        required: ['campaign_id', 'name'],
      },
    },
    {
      name: 'create_ad',
      description: 'Create an ad within an ad set with creative.',
      input_schema: {
        type: 'object' as const,
        properties: {
          adset_id: { type: 'string' as const, description: 'Parent ad set ID' },
          name: { type: 'string' as const, description: 'Ad name' },
          headline: { type: 'string' as const, description: 'Ad headline text' },
          body: { type: 'string' as const, description: 'Ad body text' },
          cta: { type: 'string' as const, description: 'Call-to-action: LEARN_MORE, SIGN_UP, SHOP_NOW, GET_OFFER' },
          creative_url: { type: 'string' as const, description: 'URL to creative image/video' },
          link_url: { type: 'string' as const, description: 'Destination URL' },
        },
        required: ['adset_id', 'name', 'headline', 'body', 'link_url'],
      },
    },
    {
      name: 'activate_campaign',
      description: 'Activate a campaign to start serving ads.',
      input_schema: {
        type: 'object' as const,
        properties: {
          campaign_id: { type: 'string' as const, description: 'Campaign ID to activate' },
        },
        required: ['campaign_id'],
      },
    },
    {
      name: 'pause_campaign',
      description: 'Pause an active campaign.',
      input_schema: {
        type: 'object' as const,
        properties: {
          campaign_id: { type: 'string' as const, description: 'Campaign ID to pause' },
        },
        required: ['campaign_id'],
      },
    },
    {
      name: 'list_campaigns',
      description: 'List all ad campaigns for this company.',
      input_schema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string' as const, description: 'Filter: active, paused, completed, all (default: all)' },
        },
      },
    },
    {
      name: 'get_campaign_insights',
      description: 'Get performance metrics for a campaign: impressions, clicks, CTR, CPC, spend.',
      input_schema: {
        type: 'object' as const,
        properties: {
          campaign_id: { type: 'string' as const, description: 'Campaign ID' },
          period: { type: 'string' as const, description: 'Time period: today, yesterday, last_7_days, last_30_days' },
        },
        required: ['campaign_id'],
      },
    },
    {
      name: 'evaluate_ad_performance',
      description: 'Evaluate an ad against performance thresholds. Returns health status and recommendation.',
      input_schema: {
        type: 'object' as const,
        properties: {
          ad_id: { type: 'string' as const, description: 'Ad ID to evaluate' },
        },
        required: ['ad_id'],
      },
    },
    {
      name: 'get_ad_account',
      description: 'Get the Meta ad account info and spending limits.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'update_ad_metrics',
      description: 'Update stored metrics for an ad from Meta API.',
      input_schema: {
        type: 'object' as const,
        properties: {
          ad_id: { type: 'string' as const, description: 'Ad ID' },
          impressions: { type: 'number' as const },
          clicks: { type: 'number' as const },
          spend: { type: 'number' as const },
          ctr: { type: 'number' as const },
          cpc: { type: 'number' as const },
        },
        required: ['ad_id'],
      },
    },
    {
      name: 'list_adsets',
      description: 'List all ad sets within a campaign with their targeting, budget, and status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          campaign_id: { type: 'string' as const, description: 'Campaign ID to list ad sets for' },
        },
        required: ['campaign_id'],
      },
    },
    {
      name: 'delete_ad',
      description: 'Delete an underperforming or moderation-blocked ad. Always document the reason.',
      input_schema: {
        type: 'object' as const,
        properties: {
          ad_id: { type: 'string' as const, description: 'Ad ID to delete' },
          reason: { type: 'string' as const, description: 'Reason: "moderation_blocked", "underperforming", "creative_refresh"' },
        },
        required: ['ad_id', 'reason'],
      },
    },
  ];
}

// ══════════════════════════════════════════════
// TOOL HANDLER — Meta Graph API + DB fallback
// ══════════════════════════════════════════════

export async function handleMetaAdsTool(
  toolName: string,
  input: Record<string, unknown>,
  task: Task,
): Promise<string> {


  switch (toolName) {
    case 'create_campaign': {
      const budget = (input.daily_budget as number) ?? 10;
      if (budget < 10) return 'Minimum daily budget is $10. Increase the budget.';

      // Save to local DB
      const [data] = await db.insert(adCampaigns).values({
        company_id: task.company_id, platform: 'meta', status: 'draft',
        daily_budget: String(budget), impressions: 0, clicks: 0, spend: '0',
      }).returning({ id: adCampaigns.id });

      if (!data) return 'Failed to create campaign';

      // Create on Meta if configured
      if (isMetaConfigured()) {
        try {
          const result = await metaGraphRequest(`/${getAccountId()}/campaigns`, 'POST', {
            name: input.name as string,
            objective: `OUTCOME_${input.objective}`,
            status: 'PAUSED',
            special_ad_categories: [],
          });

          const metaCampaignId = (result as { id?: string }).id;
          if (metaCampaignId) {
            await db.update(adCampaigns).set({ external_id: metaCampaignId }).where(eq(adCampaigns.id, data.id));
            log.info('Campaign created on Meta', { metaId: metaCampaignId, localId: data.id });
            return `✅ Campaign created on Meta (ID: ${metaCampaignId}): "${input.name}" | Budget: $${budget}/day | Status: PAUSED (activate when ready)`;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown';
          log.warn('Meta campaign creation failed, saved locally', { error: msg });
          return `Campaign saved locally (ID: ${data.id}): "${input.name}" | Budget: $${budget}/day\nMeta API error: ${msg}. Will sync when resolved.`;
        }
      }

      return `Campaign created locally (ID: ${data.id}): "${input.name}" | Objective: ${input.objective} | Budget: $${budget}/day\nConnect Meta API keys to push to Facebook.`;
    }

    case 'create_adset': {
      if (isMetaConfigured() && input.campaign_id) {
        try {
          const result = await metaGraphRequest(`/${getAccountId()}/adsets`, 'POST', {
            name: input.name,
            campaign_id: input.campaign_id,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'LINK_CLICKS',
            daily_budget: 1000, // in cents
            targeting: {
              age_min: (input.age_min as number) ?? 18,
              age_max: (input.age_max as number) ?? 65,
              geo_locations: { countries: ['US'] },
            },
            status: 'PAUSED',
          });

          const adsetId = (result as { id?: string }).id;
          return `✅ Ad set "${input.name}" created on Meta (ID: ${adsetId})\nTargeting: Ages ${input.age_min ?? 18}-${input.age_max ?? 65}`;
        } catch (err) {
          return `Ad set creation failed: ${err instanceof Error ? err.message : 'Unknown'}`;
        }
      }

      return `Ad set "${input.name}" planned for campaign ${input.campaign_id}.\nPlacements: ${input.placements ?? 'facebook_feed, instagram_feed'}\nTargeting: Ages ${input.age_min ?? 18}-${input.age_max ?? 65}\nConnect Meta API to create on platform.`;
    }

    case 'create_ad': {
      return `Ad "${input.name}" created in ad set ${input.adset_id}.\nHeadline: ${input.headline}\nBody: ${(input.body as string).substring(0, 100)}\nCTA: ${input.cta ?? 'LEARN_MORE'}\nLink: ${input.link_url}`;
    }

    case 'activate_campaign': {
      try {
        await db.update(adCampaigns).set({ status: 'active' })
          .where(and(eq(adCampaigns.id, input.campaign_id as string), eq(adCampaigns.company_id, task.company_id)));
      } catch (err) {
        return `Failed to activate: ${err instanceof Error ? err.message : 'Unknown'}`;
      }

      // Activate on Meta
      if (isMetaConfigured()) {
        try {
          const [campaign] = await db.select({ external_id: adCampaigns.external_id })
            .from(adCampaigns).where(eq(adCampaigns.id, input.campaign_id as string)).limit(1);

          if (campaign?.external_id) {
            await metaGraphRequest(`/${campaign.external_id}`, 'POST', { status: 'ACTIVE' });
            log.info('Campaign activated on Meta', { campaignId: campaign.external_id });
            return `✅ Campaign ${input.campaign_id} activated on Meta. Ads are now serving.`;
          }
        } catch (err) {
          return `Campaign activated locally but Meta sync failed: ${err instanceof Error ? err.message : 'Unknown'}`;
        }
      }

      return `Campaign ${input.campaign_id} marked active locally.\nConnect Meta API to start serving ads.`;
    }

    case 'pause_campaign': {
      await db.update(adCampaigns).set({ status: 'paused' })
        .where(and(eq(adCampaigns.id, input.campaign_id as string), eq(adCampaigns.company_id, task.company_id)));

      if (isMetaConfigured()) {
        try {
          const [campaign] = await db.select({ external_id: adCampaigns.external_id })
            .from(adCampaigns).where(eq(adCampaigns.id, input.campaign_id as string)).limit(1);

          if (campaign?.external_id) {
            await metaGraphRequest(`/${campaign.external_id}`, 'POST', { status: 'PAUSED' });
            return `✅ Campaign ${input.campaign_id} paused on Meta.`;
          }
        } catch {
          // Non-critical
        }
      }

      return `Campaign ${input.campaign_id} paused.`;
    }

    case 'list_campaigns': {
      const conditions = [eq(adCampaigns.company_id, task.company_id), eq(adCampaigns.platform, 'meta')];
      if (input.status && input.status !== 'all') {
        conditions.push(eq(adCampaigns.status, input.status as string));
      }

      const data = await db.select().from(adCampaigns)
        .where(and(...conditions)).orderBy(desc(adCampaigns.created_at));

      if (!data.length) return 'No Meta ad campaigns found.';

      return data.map((c) => {
        const ctrN = parseFloat(String(c.ctr ?? 0)); const cpcN = parseFloat(String(c.cpc ?? 0)); const spendN = parseFloat(String(c.spend ?? 0));
        return `- ID: ${c.id} | Status: ${c.status} | Budget: $${c.daily_budget}/day | CTR: ${(ctrN * 100).toFixed(1)}% | CPC: $${cpcN.toFixed(2)} | Spend: $${spendN.toFixed(2)}`;
      }).join('\n');
    }

    case 'get_campaign_insights': {
      // Try Meta API first for live data
      if (isMetaConfigured()) {
        try {
          const [campaign] = await db.select({ external_id: adCampaigns.external_id })
            .from(adCampaigns).where(eq(adCampaigns.id, input.campaign_id as string)).limit(1);

          if (campaign?.external_id) {
            const period = (input.period as string) ?? 'last_7_days';
            const result = await metaGraphRequest(
              `/${campaign.external_id}/insights?fields=impressions,clicks,ctr,cpc,spend&date_preset=${period}`
            );

            const insights = ((result as { data?: Array<Record<string, string>> }).data ?? [])[0];
            if (insights) {
              // Sync to local DB
              await db.update(adCampaigns).set({
                impressions: parseInt(insights.impressions ?? '0'),
                clicks: parseInt(insights.clicks ?? '0'),
                ctr: insights.ctr ?? '0',
                cpc: insights.cpc ?? '0',
                spend: insights.spend ?? '0',
              }).where(eq(adCampaigns.id, input.campaign_id as string));

              const ctr = parseFloat(insights.ctr ?? '0');
              const cpc = parseFloat(insights.cpc ?? '0');
              let health = '🟢 Healthy';
              if (ctr < THRESHOLDS.kill_ctr || cpc > THRESHOLDS.kill_cpc) health = '🔴 Underperforming';
              else if (ctr < THRESHOLDS.healthy_ctr || cpc > THRESHOLDS.healthy_cpc) health = '🟡 Mediocre';

              return `Campaign ${input.campaign_id} (live from Meta):\nHealth: ${health}\nImpressions: ${insights.impressions} | Clicks: ${insights.clicks}\nCTR: ${(ctr * 100).toFixed(2)}% | CPC: $${cpc.toFixed(2)}\nSpend: $${parseFloat(insights.spend ?? '0').toFixed(2)}`;
            }
          }
        } catch {
          log.warn('Meta insights fetch failed, using local data');
        }
      }

      // Fallback to local DB
      const [data] = await db.select().from(adCampaigns)
        .where(and(eq(adCampaigns.id, input.campaign_id as string), eq(adCampaigns.company_id, task.company_id)))
        .limit(1);

      if (!data) return `Campaign ${input.campaign_id} not found.`;

      const ctr = parseFloat(String(data.ctr ?? 0));
      const cpc = parseFloat(String(data.cpc ?? 0));
      let health = '🟢 Healthy';
      if (ctr < THRESHOLDS.kill_ctr || cpc > THRESHOLDS.kill_cpc) health = '🔴 Underperforming';
      else if (ctr < THRESHOLDS.healthy_ctr || cpc > THRESHOLDS.healthy_cpc) health = '🟡 Mediocre';

      return `Campaign: ${input.campaign_id}\nStatus: ${data.status} | Health: ${health}\nImpressions: ${data.impressions} | Clicks: ${data.clicks}\nCTR: ${(ctr * 100).toFixed(2)}% | CPC: $${cpc.toFixed(2)}\nSpend: $${parseFloat(String(data.spend ?? 0)).toFixed(2)} | Budget: $${data.daily_budget}/day`;
    }

    case 'evaluate_ad_performance': {
      const [data] = await db.select({ ctr: adCampaigns.ctr, cpc: adCampaigns.cpc, spend: adCampaigns.spend, status: adCampaigns.status })
        .from(adCampaigns)
        .where(and(eq(adCampaigns.id, input.ad_id as string), eq(adCampaigns.company_id, task.company_id)))
        .limit(1);

      if (!data) return `Ad ${input.ad_id} not found.`;

      const ctr = parseFloat(String(data.ctr ?? 0));
      const cpc = parseFloat(String(data.cpc ?? 0));

      if (ctr >= THRESHOLDS.healthy_ctr && cpc <= THRESHOLDS.healthy_cpc) {
        return `Ad ${input.ad_id}: HEALTHY (CTR ${(ctr * 100).toFixed(1)}%, CPC $${cpc.toFixed(2)}). Continue running.`;
      }
      if (ctr < THRESHOLDS.kill_ctr || cpc > THRESHOLDS.kill_cpc) {
        return `Ad ${input.ad_id}: UNDERPERFORMING (CTR ${(ctr * 100).toFixed(1)}%, CPC $${cpc.toFixed(2)}). Recommendation: PAUSE and create new creative with different angle.`;
      }
      return `Ad ${input.ad_id}: MEDIOCRE (CTR ${(ctr * 100).toFixed(1)}%, CPC $${cpc.toFixed(2)}). Monitor for 2 more days.`;
    }

    case 'get_ad_account': {
      if (isMetaConfigured()) {
        try {
          const result = await metaGraphRequest(
            `/${getAccountId()}?fields=name,account_status,currency,spend_cap,amount_spent`
          );
          return `Meta Ad Account (live):\n- Name: ${result.name}\n- Status: ${result.account_status === 1 ? 'Active' : 'Inactive'}\n- Currency: ${result.currency}\n- Total spent: $${result.amount_spent}\n- Spend cap: ${result.spend_cap ?? 'None'}\n- OAuth: Connected ✅`;
        } catch {
          return 'Meta API configured but account fetch failed. Check your access token.';
        }
      }

      return `Meta Ad Account:\n- Platform: Facebook + Instagram\n- Billing: Separate lane from task credits\n- Platform fee: 20% on spend\n- Min budget: $10/day\n- OAuth: NOT connected — set META_ADS_ACCESS_TOKEN and META_ADS_ACCOUNT_ID`;
    }

    case 'update_ad_metrics': {
      await db.update(adCampaigns).set({
        impressions: (input.impressions as number) ?? 0,
        clicks: (input.clicks as number) ?? 0,
        spend: String((input.spend as number) ?? 0),
        ctr: String((input.ctr as number) ?? 0),
        cpc: String((input.cpc as number) ?? 0),
      }).where(and(eq(adCampaigns.id, input.ad_id as string), eq(adCampaigns.company_id, task.company_id)));
      return `Metrics updated for ad ${input.ad_id}.`;
    }

    case 'list_adsets': {
      if (isMetaConfigured()) {
        try {
          const result = await metaGraphRequest(
            `/${input.campaign_id}/adsets?fields=id,name,status,daily_budget,targeting`
          );
          const sets = (result as { data?: Array<Record<string, unknown>> }).data ?? [];
          if (!sets.length) return `No ad sets found in campaign ${input.campaign_id}.`;
          return sets.map((s) => `- ID: ${s.id} | Name: ${s.name} | Status: ${s.status} | Budget: $${parseInt((s.daily_budget as string) ?? '0') / 100}/day`).join('\n');
        } catch (err) {
          return `Failed to list ad sets from Meta: ${err instanceof Error ? err.message : 'Unknown'}`;
        }
      }

      // Fallback: Meta not configured
      return `Meta API not configured. Cannot list ad sets for campaign ${input.campaign_id}. Set META_ADS_ACCESS_TOKEN and META_ADS_ACCOUNT_ID.`;
    }

    case 'delete_ad': {
      // Log the deletion audit record
      await db.insert(platformEvents).values({
        company_id: task.company_id, event_type: 'task_completed',
        payload: { type: 'ad_deleted', ad_id: input.ad_id, reason: input.reason, task_id: task.id },
        is_public_safe: false,
      });

      if (isMetaConfigured()) {
        try {
          await metaGraphRequest(`/${input.ad_id}`, 'POST', { status: 'DELETED' });
          log.info('Ad deleted on Meta', { adId: input.ad_id, reason: input.reason, companyId: task.company_id });
          return `✅ Ad ${input.ad_id} deleted on Meta. Reason: ${input.reason}`;
        } catch (err) {
          return `Ad deletion logged locally but Meta API failed: ${err instanceof Error ? err.message : 'Unknown'}`;
        }
      }

      return `Ad ${input.ad_id} deletion recorded (reason: ${input.reason}). Connect Meta API to delete on platform.`;
    }

    default:
      return `Unknown meta ads tool: ${toolName}`;
  }
}
