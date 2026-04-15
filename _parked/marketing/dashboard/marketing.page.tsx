// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { ContentCalendar } from '@/components/dashboard/marketing/ContentCalendar';
import { PostComposer } from '@/components/dashboard/marketing/PostComposer';
import { AnalyticsPanel } from '@/components/dashboard/marketing/AnalyticsPanel';
import { EngagementQueue } from '@/components/dashboard/marketing/EngagementQueue';
import { ConnectionsPanel } from '@/components/dashboard/marketing/ConnectionsPanel';
interface Company {
  id: string;
  name: string;
  slug: string;
  company_stage: string;
}

interface User {
  id: string;
  name: string | null;
  email: string;
}

type TabType = 'calendar' | 'create' | 'analytics' | 'engagement' | 'connections';

interface MarketingStats {
  totalPosts: number;
  scheduledPosts: number;
  publishedPosts: number;
  totalImpressions: number;
  engagementRate: number;
}

export default function MarketingPage() {
  const params = useParams();
  const companyId = params.companyId as string;

  const [company, setCompany] = useState<Company | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>('calendar');
  const [stats, setStats] = useState<MarketingStats>({
    totalPosts: 0,
    scheduledPosts: 0,
    publishedPosts: 0,
    totalImpressions: 0,
    engagementRate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);

        // Load company data
        const companyRes = await fetch(`/api/companies/${companyId}`);
        if (companyRes.ok) {
          const companyData = await companyRes.json();
          setCompany(companyData.company);
        }

        // Load user data
        const userRes = await fetch('/api/user');
        if (userRes.ok) {
          const userData = await userRes.json();
          setUser(userData.user);
          setCreditBalance(userData.creditBalance);
        }

        // Load marketing stats
        const statsRes = await fetch(`/api/marketing/stats?companyId=${companyId}`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }
      } catch (error) {
        console.error('Error loading marketing data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [companyId]);

  if (loading || !company || !user) {
    return (
      <div className="min-h-screen bg-surface-primary">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-baljia-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-text-secondary">Loading marketing dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <DashboardHeader company={company} user={user} creditBalance={creditBalance} />

      <main className="px-4 py-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold font-[family-name:var(--font-display)] text-text-primary mb-2">
                Marketing Command Center
              </h1>
              <p className="text-text-secondary">
                Campaign phase: <span className="text-baljia-gold font-semibold capitalize">{company.company_stage}</span>
              </p>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            <StatCard label="Total Posts" value={stats.totalPosts} />
            <StatCard label="Scheduled" value={stats.scheduledPosts} />
            <StatCard label="Published" value={stats.publishedPosts} />
            <StatCard label="Total Impressions" value={stats.totalImpressions.toLocaleString()} />
            <StatCard
              label="Engagement Rate"
              value={`${stats.engagementRate.toFixed(2)}%`}
            />
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8 border-b border-border-default overflow-x-auto pb-4">
          {(['calendar', 'create', 'analytics', 'engagement', 'connections'] as const).map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-baljia-gold text-surface-primary'
                    : 'text-text-secondary hover:text-text-primary border border-border-default'
                }`}
              >
                {tab === 'calendar' && 'Calendar'}
                {tab === 'create' && 'Create'}
                {tab === 'analytics' && 'Analytics'}
                {tab === 'engagement' && 'Engagement'}
                {tab === 'connections' && 'Connections'}
              </button>
            )
          )}
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'calendar' && <ContentCalendar companyId={companyId} />}
          {activeTab === 'create' && <PostComposer companyId={companyId} />}
          {activeTab === 'analytics' && <AnalyticsPanel companyId={companyId} />}
          {activeTab === 'engagement' && <EngagementQueue companyId={companyId} />}
          {activeTab === 'connections' && <ConnectionsPanel companyId={companyId} />}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-4 bg-surface-card border border-border-default rounded-lg">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
    </div>
  );
}
