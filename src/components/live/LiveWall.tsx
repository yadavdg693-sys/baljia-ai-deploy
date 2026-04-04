'use client';

import { useEffect, useState, useRef } from 'react';
import styles from './LiveWall.module.css';

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface LiveEvent {
  id: string;
  type: string;
  company_id: string;
  payload: Record<string, unknown>;
  is_public: boolean;
  created_at: string;
}

interface RunningTask {
  id: string;
  title: string;
  agent_name: string;
  company_name: string;
  started_at: string;
  running_seconds: number;
  tag: string;
}

interface Metrics {
  active_companies: number;
  tasks_today: number;
  tasks_running: number;
  messages_today: number;
  emails_today: number;
  annual_run_rate: string;
}

// ══════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════

export function LiveWall() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/events/stream?publicOnly=true');
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'snapshot') {
          setEvents(data.events ?? []);
          setMetrics(data.metrics ?? null);
          setTasks(data.runningTasks ?? []);
        }

        if (data.type === 'events') {
          setEvents((prev) => [...(data.events ?? []), ...prev].slice(0, 50));
        }

        if (data.type === 'heartbeat') {
          setTasks(data.runningTasks ?? []);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Timer tick for running counters
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.wall}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>◆</span>
            <span className={styles.logoText}>Baljia</span>
          </div>
          <div className={`${styles.connectionDot} ${connected ? styles.connected : styles.disconnected}`} />
          <span className={styles.connectionLabel}>{connected ? 'Live' : 'Connecting...'}</span>
        </div>
        <h1 className={styles.headerTitle}>Operations Wall</h1>
      </header>

      {/* Three-column layout */}
      <div className={styles.columns}>
        {/* LEFT COLUMN — Status + Metrics */}
        <div className={styles.column}>
          <MascotCard connected={connected} tasksRunning={tasks.length} />
          {metrics && <MetricsPanel metrics={metrics} />}
        </div>

        {/* CENTER COLUMN — Tasks + Events */}
        <div className={`${styles.column} ${styles.centerColumn}`}>
          <h2 className={styles.sectionTitle}>
            Running Tasks
            {tasks.length > 0 && <span className={styles.badge}>{tasks.length}</span>}
          </h2>
          {tasks.length === 0 ? (
            <div className={styles.emptyState}>No tasks running right now</div>
          ) : (
            tasks.map((task) => (
              <TaskCard key={task.id} task={task} tick={tick} />
            ))
          )}

          <h2 className={styles.sectionTitle}>Activity Feed</h2>
          <div className={styles.eventList}>
            {events.slice(0, 20).map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
            {events.length === 0 && (
              <div className={styles.emptyState}>Waiting for activity...</div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Recent completions + CTA */}
        <div className={styles.column}>
          <h2 className={styles.sectionTitle}>Recent Completions</h2>
          {events
            .filter((e) => e.type === 'task_completed')
            .slice(0, 8)
            .map((e) => (
              <CompletionCard key={e.id} event={e} />
            ))}

          <div className={styles.ctaCard}>
            <div className={styles.ctaIcon}>✦</div>
            <h3 className={styles.ctaTitle}>Build with Baljia</h3>
            <p className={styles.ctaText}>AI agents that actually build and grow your business.</p>
            <a href="/login" className={styles.ctaButton}>Get Started</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// SUB-COMPONENTS
// ══════════════════════════════════════════════

function MascotCard({ connected, tasksRunning }: { connected: boolean; tasksRunning: number }) {
  const state = tasksRunning > 0 ? 'Running' : connected ? 'Listening' : 'Connecting';
  const glowClass = tasksRunning > 0 ? styles.glowAmber : styles.glowIndigo;

  return (
    <div className={`${styles.mascotCard} ${glowClass}`}>
      <div className={styles.mascotAvatar}>◆</div>
      <div className={styles.mascotInfo}>
        <div className={styles.mascotState}>{state}</div>
        <div className={styles.mascotSub}>
          {tasksRunning > 0 ? `${tasksRunning} task${tasksRunning > 1 ? 's' : ''} in progress` : 'Ready for work'}
        </div>
      </div>
    </div>
  );
}

function MetricsPanel({ metrics }: { metrics: Metrics }) {
  return (
    <div className={styles.metricsGrid}>
      <MetricTile label="ARR" value={metrics.annual_run_rate} />
      <MetricTile label="Active" value={metrics.active_companies.toString()} />
      <MetricTile label="Tasks Today" value={metrics.tasks_today.toString()} />
      <MetricTile label="Messages" value={metrics.messages_today.toString()} />
      <MetricTile label="Emails" value={metrics.emails_today.toString()} />
      <MetricTile label="Running" value={metrics.tasks_running.toString()} highlight />
    </div>
  );
}

function MetricTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`${styles.metricTile} ${highlight ? styles.metricHighlight : ''}`}>
      <div className={styles.metricValue}>{value}</div>
      <div className={styles.metricLabel}>{label}</div>
    </div>
  );
}

function TaskCard({ task, tick }: { task: RunningTask; tick: number }) {
  const elapsed = task.running_seconds + tick;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className={styles.taskCard}>
      <div className={styles.taskHeader}>
        <span className={styles.taskTitle}>{task.title}</span>
        <span className={styles.taskTimer}>{minutes}m {seconds.toString().padStart(2, '0')}s</span>
      </div>
      <div className={styles.taskMeta}>
        <span className={styles.agentPill}>{task.agent_name}</span>
        <span className={styles.taskCompany}>{task.company_name}</span>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: LiveEvent }) {
  const payload = event.payload;
  const title = (payload.title as string) ?? (payload.type as string) ?? event.type;
  const time = new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const icon = getEventIcon(event.type);

  return (
    <div className={styles.eventRow}>
      <span className={styles.eventIcon}>{icon}</span>
      <span className={styles.eventTitle}>{title}</span>
      <span className={styles.eventTime}>{time}</span>
    </div>
  );
}

function CompletionCard({ event }: { event: LiveEvent }) {
  const payload = event.payload;
  const title = (payload.title as string) ?? 'Task completed';
  const agent = (payload.agent as string) ?? '';
  const time = new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={styles.completionCard}>
      <div className={styles.completionTitle}>{title}</div>
      <div className={styles.completionMeta}>
        {agent && <span className={styles.agentPill}>{agent}</span>}
        <span className={styles.eventTime}>{time}</span>
      </div>
    </div>
  );
}

function getEventIcon(type: string): string {
  switch (type) {
    case 'task_created': return '📋';
    case 'task_started': return '⚡';
    case 'task_completed': return '✅';
    case 'task_failed': return '❌';
    case 'task_approved': return '👍';
    case 'task_rejected': return '👎';
    case 'credits_purchased': return '💳';
    case 'credits_depleted': return '⚠️';
    case 'night_shift_started': return '🌙';
    case 'night_shift_completed': return '☀️';
    case 'chat_message': return '💬';
    case 'document_updated': return '📄';
    case 'company_created': return '🏢';
    default: return '•';
  }
}
