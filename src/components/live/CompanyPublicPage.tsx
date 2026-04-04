'use client';

import styles from './CompanyPublicPage.module.css';

interface CompanyPublicPageProps {
  company: {
    name: string;
    slug: string;
    one_liner: string | null;
    stage: string;
    created_at: string;
  };
  stats: {
    tasks_completed: number;
    reports_generated: number;
  };
  recentActivity: Array<{
    type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
}

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  early: { label: 'Early Stage', color: '#6366f1' },
  validation: { label: 'Validation', color: '#8b5cf6' },
  monetization: { label: 'Monetization', color: '#f59e0b' },
  retention: { label: 'Retention', color: '#22c55e' },
  scale: { label: 'Scale', color: '#f97316' },
  compounding: { label: 'Compounding', color: '#ef4444' },
};

export function CompanyPublicPage({ company, stats, recentActivity }: CompanyPublicPageProps) {
  const stage = STAGE_LABELS[company.stage] ?? STAGE_LABELS.early;
  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(company.created_at).getTime()) / 86400000
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <a href="/live" className={styles.backLink}>← Live Wall</a>
        <span className={styles.poweredBy}>Built with <strong>Baljia</strong></span>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.companyIcon}>
          {company.name.charAt(0).toUpperCase()}
        </div>
        <h1 className={styles.companyName}>{company.name}</h1>
        {company.one_liner && (
          <p className={styles.oneLiner}>{company.one_liner}</p>
        )}
        <div className={styles.stageBadge} style={{ borderColor: stage.color, color: stage.color }}>
          {stage.label}
        </div>
      </section>

      {/* Stats */}
      <section className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.tasks_completed}</div>
          <div className={styles.statLabel}>Tasks Completed</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.reports_generated}</div>
          <div className={styles.statLabel}>Reports Generated</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{daysSinceCreation}</div>
          <div className={styles.statLabel}>Days Active</div>
        </div>
      </section>

      {/* Activity */}
      {recentActivity.length > 0 && (
        <section className={styles.activity}>
          <h2 className={styles.sectionTitle}>Recent Activity</h2>
          <div className={styles.activityList}>
            {recentActivity.map((event, i) => (
              <div key={i} className={styles.activityItem}>
                <span className={styles.activityDot} />
                <span className={styles.activityText}>
                  {(event.payload.title as string) ?? event.type.replace(/_/g, ' ')}
                </span>
                <span className={styles.activityTime}>
                  {new Date(event.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className={styles.cta}>
        <p className={styles.ctaText}>Want AI agents to build your business too?</p>
        <a href="/login" className={styles.ctaButton}>Start with Baljia</a>
      </section>
    </div>
  );
}
