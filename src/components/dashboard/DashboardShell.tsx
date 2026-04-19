'use client';

import { useState, useCallback } from 'react';
import type { Company, Task, Document, Report } from '@/types';
import type { User } from '@/types';
import { BaljiaMascot } from '@/components/mascot/BaljiaMascot';
import { CompanyHeader } from './CompanyHeader';
import { TaskBoard } from './TaskBoard';
import { TaskDetailDialog } from './TaskDetailDialog';
import { DocumentList } from './DocumentList';
import { MetricsPanel } from './MetricsPanel';
import { CreditDisplay } from './CreditDisplay';
import { PurchaseCreditsDialog } from './PurchaseCreditsDialog';
import { ActivityFeed } from './ActivityFeed';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { DashboardHeader } from './DashboardHeader';
import { TwitterPreview } from './TwitterPreview';
import { EmailPreview } from './EmailPreview';
import { AdsPreview } from './AdsPreview';
import { LinksSection } from './LinksSection';
import { UpgradeDialog } from './UpgradeDialog';
import { RoadmapRail } from './RoadmapRail';
import { OnboardingProgress } from './OnboardingProgress';
import { DocumentSuggestionPanel } from './DocumentSuggestionPanel';

interface DocumentSuggestion {
  id: string;
  document_id: string;
  suggested_content: string;
  reason: string | null;
  status: string;
  created_at: string;
}

interface DashboardShellProps {
  company: Company;
  tasks: Task[];
  documents: Document[];
  reports: Report[];
  creditBalance: number;
  recentUsage: number[];
  pendingSuggestions: DocumentSuggestion[];
  user: User;
}

export function DashboardShell({
  company,
  tasks: initialTasks,
  documents,
  reports,
  creditBalance,
  recentUsage,
  pendingSuggestions,
  user,
}: DashboardShellProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [suggestions, setSuggestions] = useState(pendingSuggestions);

  // State-only callbacks — TaskDetailDialog owns the API mutation.
  // These just sync local state after the dialog confirms success.
  const handleApprove = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' as const } : t))
    );
  }, []);

  const handleReject = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'rejected' as const } : t))
    );
  }, []);

  // Handle document suggestion actions
  const handleSuggestionAction = useCallback(async (id: string, action: 'accept' | 'skip') => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/document-suggestions/${id}/${action}`, { method: 'POST' });
    } catch {
      // Silently fail — suggestion already removed from UI
    }
  }, []);

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      {/* Top header bar — matches Polsia: company name + New + Menu */}
      <DashboardHeader company={company} user={user} creditBalance={creditBalance} />

      {/* Desktop: 3-column layout | Mobile: single column */}
      <div className="mx-auto max-w-[1600px] p-4 lg:grid lg:grid-cols-[280px_1fr_380px] lg:gap-6">

        {/* ── Left Column: Mascot + Credits + Metrics ── */}
        <aside className="hidden lg:flex lg:flex-col lg:gap-4">
          {/* Mascot card */}
          <div className="rounded-xl bg-surface-card border border-border-default p-5 flex flex-col items-center gap-3">
            <BaljiaMascot
              status={{ state: 'listening', label: 'Ready', detail: 'Waiting for instructions' }}
              size="dashboard"
              showLabel={false}
              showDetail={false}
            />
            <div className="text-center">
              <p className="font-bold text-baljia-gold">{company.name}</p>
              {company.one_liner && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2">{company.one_liner}</p>
              )}
            </div>
          </div>

          {/* Credits */}
          <CreditDisplay
            balance={creditBalance}
            planTier={company.plan_tier}
            recentUsage={recentUsage}
            onPurchase={() => setPurchaseOpen(true)}
          />

          {/* Business — matches Polsia left sidebar */}
          <div className="rounded-xl bg-surface-card border border-border-default p-4">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Business</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Revenue:</span>
                <span className="font-semibold">$0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Balance:</span>
                <span className="font-semibold">$0.00</span>
                <button className="ml-2 px-2 py-0.5 text-xs rounded border border-border-default text-text-muted hover:text-text-primary transition-colors">
                  Withdraw
                </button>
              </div>
            </div>
            <p className="text-xs text-text-muted mt-3">
              Updated just now <button className="text-text-muted hover:text-text-secondary underline">(refresh)</button>
            </p>
          </div>

          {/* Upgrade CTA — like Polsia "Hire Your AI Employee" */}
          {company.plan_tier === 'trial' && (
            <div className="rounded-xl bg-surface-card border border-border-default p-5 text-center">
              <p className="font-semibold text-text-primary mb-1">Hire Your AI Employee</p>
              <p className="text-xs text-text-muted mb-4">$1.63/day &middot; Works while you sleep</p>
              <button
                onClick={() => setUpgradeOpen(true)}
                className="w-full py-3 rounded-xl bg-baljia-gold text-surface-primary font-semibold hover:bg-baljia-gold-light transition-colors"
              >
                Start free trial
              </button>
              <p className="text-xs text-text-muted mt-2">3-day trial &middot; $49/mo</p>
            </div>
          )}

          {/* Stage */}
          <div className="rounded-xl bg-surface-card border border-border-default p-4">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Stage</h3>
            <p className="text-sm font-medium capitalize">{company.company_stage}</p>
            <p className="text-xs text-text-muted mt-1 capitalize">{company.lifecycle.replace(/_/g, ' ')}</p>
          </div>

          {/* Onboarding progress — visible while onboarding is still running */}
          {(company.onboarding_status === 'initializing' || company.onboarding_status === 'running') && (
            <OnboardingProgress
              companyId={company.id}
              status={company.onboarding_status}
            />
          )}

          {/* Roadmap */}
          <RoadmapRail companyId={company.id} />
        </aside>

        {/* ── Center Column: Tasks + Documents + Ledger ── */}
        <main className="min-w-0 space-y-6">
          {/* Mobile company header */}
          <div className="lg:hidden mb-4">
            <CompanyHeader company={company} />
          </div>

          {/* Desktop company header */}
          <div className="hidden lg:block">
            <CompanyHeader company={company} />
          </div>

          {/* Task board */}
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Tasks</h2>
            <TaskBoard
              tasks={tasks}
              onTaskClick={setSelectedTask}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          </section>

          {/* Document Suggestion Review — Accept / Edit / Skip */}
          <section>
            <DocumentSuggestionPanel companyId={company.id} />
          </section>

          {/* Documents */}
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Documents</h2>
            <div className="rounded-xl bg-surface-card border border-border-default p-4">
              <DocumentList documents={documents} />
            </div>
          </section>

          {/* Reports */}
          {reports.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Recent Reports</h2>
              <div className="rounded-xl bg-surface-card border border-border-default p-4 space-y-2">
                {reports.map((report) => (
                  <div key={report.id} className="p-3 rounded-lg bg-surface-secondary">
                    <p className="text-sm font-medium">{report.title ?? 'Untitled Report'}</p>
                    <p className="text-xs text-text-muted capitalize">{report.report_type}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* ── Right Column: Twitter + Email + Ads + Links + Chat + Activity ── */}
        <aside className="hidden lg:flex lg:flex-col lg:gap-4">
          {/* Twitter */}
          <TwitterPreview handle={null} latestTweet={null} />

          {/* Email */}
          <EmailPreview
            companyEmail={company.email_identity}
            latestEmail={null}
            sentCount={0}
            receivedCount={0}
          />

          {/* Ads */}
          <AdsPreview activeCampaigns={0} />

          {/* Links */}
          <LinksSection
            companyName={company.name}
            subdomain={company.subdomain}
            customDomain={company.custom_domain}
          />

          {/* Chat panel */}
          <ChatPanel companyId={company.id} />

          {/* Activity feed */}
          <div className="rounded-xl bg-surface-card border border-border-default p-4">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Activity</h3>
            <ActivityFeed companyId={company.id} />
          </div>
        </aside>
      </div>

      {/* ── Task detail dialog ── */}
      <TaskDetailDialog
        task={selectedTask}
        open={selectedTask !== null}
        onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      {/* ── Purchase credits dialog ── */}
      <PurchaseCreditsDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        currentBalance={creditBalance}
      />

      {/* ── Upgrade dialog ── */}
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        companyId={company.id}
      />

      {/* ── Mobile: slide-up chat drawer ── */}
      {chatOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setChatOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute bottom-0 left-0 right-0 h-[85vh] bg-surface-primary rounded-t-2xl border-t border-border-default shadow-2xl animate-slide-up">
            {/* Handle bar */}
            <div className="flex items-center justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-border-default" />
            </div>
            {/* Chat */}
            <div className="h-[calc(85vh-40px)]">
              <ChatPanel companyId={company.id} />
            </div>
          </div>
        </div>
      )}

      {/* Mobile: floating chat button */}
      <button
        className="lg:hidden fixed bottom-6 right-6 w-14 h-14 rounded-full bg-baljia-gold text-surface-primary flex items-center justify-center shadow-lg hover:bg-baljia-gold-light transition-colors z-30"
        onClick={() => setChatOpen(!chatOpen)}
        aria-label="Open CEO chat"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {chatOpen ? (
            <path d="M18 6 6 18M6 6l12 12" />
          ) : (
            <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
          )}
        </svg>
      </button>
    </div>
  );
}
