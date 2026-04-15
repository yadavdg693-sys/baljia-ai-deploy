'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface AnalyticsPanelProps {
  companyId: string;
}

interface AnalyticsData {
  totalImpressions: number;
  totalEngagement: number;
  avgEngagementRate: number;
  waitlistSignups: number;
  platformBreakdown: {
    platform: string;
    impressions: number;
    engagement: number;
    engagementRate: number;
  }[];
  topPosts: {
    id: string;
    platform: string;
    title: string;
    impressions: number;
    engagement: number;
    engagementRate: number;
  }[];
  weekOverWeekTrend: {
    metric: string;
    thisWeek: number;
    lastWeek: number;
    change: number;
  }[];
}

export function AnalyticsPanel({ companyId }: AnalyticsPanelProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, [companyId]);

  async function loadAnalytics() {
    try {
      setLoading(true);
      const response = await fetch(`/api/marketing/analytics?companyId=${companyId}`);
      if (response.ok) {
        const analyticsData = await response.json();
        setData(analyticsData);
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Loading analytics...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-surface-card border border-border-default rounded-lg p-8 text-center">
        <p className="text-text-secondary">No analytics data available yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Impressions"
          value={data.totalImpressions.toLocaleString()}
          trend={data.weekOverWeekTrend.find((t) => t.metric === 'impressions')}
        />
        <SummaryCard
          label="Total Engagement"
          value={data.totalEngagement.toLocaleString()}
          trend={data.weekOverWeekTrend.find((t) => t.metric === 'engagement')}
        />
        <SummaryCard
          label="Avg Engagement Rate"
          value={`${data.avgEngagementRate.toFixed(2)}%`}
          trend={data.weekOverWeekTrend.find((t) => t.metric === 'engagementRate')}
        />
        <SummaryCard
          label="Waitlist Signups"
          value={data.waitlistSignups.toLocaleString()}
          trend={data.weekOverWeekTrend.find((t) => t.metric === 'signups')}
        />
      </div>

      {/* Platform Breakdown */}
      <div className="bg-surface-card border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-6">Platform Breakdown</h3>
        <div className="space-y-4">
          {data.platformBreakdown.map((platform) => {
            const maxImpressions = Math.max(...data.platformBreakdown.map((p) => p.impressions));
            const barWidth = (platform.impressions / maxImpressions) * 100;

            return (
              <div key={platform.platform}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-secondary">{platform.platform}</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-text-primary">
                      {platform.impressions.toLocaleString()} impressions
                    </span>
                    <span className="text-xs text-text-muted ml-2">
                      {platform.engagementRate.toFixed(1)}% engagement
                    </span>
                  </div>
                </div>
                <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-baljia-gold to-baljia-gold-light rounded-full transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Performing Posts */}
      <div className="bg-surface-card border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-6">Top 5 Performing Posts</h3>
        <div className="space-y-4">
          {data.topPosts.length === 0 ? (
            <p className="text-text-muted text-sm">No posts yet</p>
          ) : (
            data.topPosts.map((post) => (
              <div
                key={post.id}
                className="p-4 bg-surface-primary border border-border-default rounded-lg hover:border-baljia-gold transition-colors"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-1 rounded bg-baljia-gold/10 text-baljia-gold font-semibold">
                        {post.platform.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-text-primary truncate">{post.title}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-text-muted mb-1">Impressions</p>
                    <p className="text-text-primary font-semibold">{post.impressions.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-text-muted mb-1">Engagement</p>
                    <p className="text-text-primary font-semibold">{post.engagement.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-text-muted mb-1">Rate</p>
                    <p className="text-text-primary font-semibold">{post.engagementRate.toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Trends */}
      <div className="bg-surface-card border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-6">Week-over-Week Trends</h3>
        <div className="space-y-3">
          {data.weekOverWeekTrend.map((trend) => (
            <div key={trend.metric} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-secondary capitalize">{trend.metric}</p>
                <p className="text-xs text-text-muted">
                  Last week: {trend.lastWeek.toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="text-sm font-semibold text-text-primary">
                    {trend.thisWeek.toLocaleString()}
                  </p>
                  <p
                    className={`text-xs font-medium flex items-center gap-1 ${
                      trend.change >= 0 ? 'text-status-success' : 'text-status-error'
                    }`}
                  >
                    {trend.change >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {Math.abs(trend.change).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string | number;
  trend?: { change: number };
}) {
  const isPositive = trend ? trend.change >= 0 : false;

  return (
    <div className="bg-surface-card border border-border-default rounded-lg p-4">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{label}</p>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold text-text-primary">{value}</p>
        {trend && (
          <div
            className={`flex items-center gap-1 text-xs font-semibold ${
              isPositive ? 'text-status-success' : 'text-status-error'
            }`}
          >
            {isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {Math.abs(trend.change).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
