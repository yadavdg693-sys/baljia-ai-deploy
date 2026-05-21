'use client';

import { useState, useEffect } from 'react';
import type { PlatformEvent } from '@/types';
import { formatRelativeTime } from '@/lib/utils';

interface ActivityFeedProps {
  companyId: string;
  initialEvents?: PlatformEvent[];
}

const EVENT_CONFIG: Record<string, { icon: string; color: string; verb: string }> = {
  task_created: { icon: '📝', color: 'text-status-planning', verb: 'created' },
  task_approved: { icon: '✓', color: 'text-status-success', verb: 'approved' },
  task_rejected: { icon: '✕', color: 'text-status-error', verb: 'rejected' },
  task_started: { icon: '⚡', color: 'text-status-running', verb: 'started' },
  task_completed: { icon: '🎉', color: 'text-status-success', verb: 'completed' },
  task_failed: { icon: '❌', color: 'text-status-error', verb: 'failed' },
  credit_purchased: { icon: '💳', color: 'text-baljia-gold', verb: 'purchased credits' },
  credit_deducted: { icon: '💰', color: 'text-status-error', verb: 'used credits' },
  document_updated: { icon: '📄', color: 'text-status-investigating', verb: 'updated' },
  company_created: { icon: '🏢', color: 'text-baljia-gold', verb: 'created company' },
  chat_message: { icon: '💬', color: 'text-text-secondary', verb: 'sent message' },
  night_shift_started: { icon: '🌙', color: 'text-status-planning', verb: 'started autopilot run' },
  night_shift_completed: { icon: '🌅', color: 'text-status-success', verb: 'finished autopilot run' },
  onboarding_stage: { icon: '🚀', color: 'text-baljia-gold', verb: 'reached stage' },
};

function groupByDate(events: PlatformEvent[]): { label: string; events: PlatformEvent[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: Record<string, PlatformEvent[]> = {};

  for (const event of events) {
    const eventDate = new Date(event.created_at);
    const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

    let label: string;
    if (eventDay.getTime() === today.getTime()) label = 'Today';
    else if (eventDay.getTime() === yesterday.getTime()) label = 'Yesterday';
    else label = eventDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (!groups[label]) groups[label] = [];
    groups[label].push(event);
  }

  return Object.entries(groups).map(([label, events]) => ({ label, events }));
}

function getEventDescription(event: PlatformEvent): string {
  const payload = event.payload as Record<string, string | undefined>;
  const config = EVENT_CONFIG[event.event_type];

  if (payload?.title) return `${config?.verb ?? event.event_type}: ${payload.title}`;
  if (payload?.description) return payload.description;
  return config?.verb ?? event.event_type.replace(/_/g, ' ');
}

export function ActivityFeed({ companyId, initialEvents = [] }: ActivityFeedProps) {
  const [events, setEvents] = useState<PlatformEvent[]>(initialEvents);
  const [loading, setLoading] = useState(initialEvents.length === 0);

  useEffect(() => {
    if (initialEvents.length > 0) return;

    async function fetchEvents() {
      try {
        const res = await fetch(`/api/events?companyId=${companyId}`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events ?? []);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchEvents();
  }, [companyId, initialEvents.length]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-surface-secondary" />
            <div className="flex-1 h-4 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-6">
        <span className="text-xl block mb-2">📡</span>
        <p className="text-xs text-text-muted">Activity will appear here as you use the platform.</p>
      </div>
    );
  }

  const grouped = groupByDate(events);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
            {group.label}
          </p>
          <div className="space-y-1">
            {group.events.map((event) => {
              const config = EVENT_CONFIG[event.event_type] ?? {
                icon: '•', color: 'text-text-muted', verb: event.event_type,
              };

              return (
                <div key={event.id} className="flex items-start gap-2.5 py-1.5 group">
                  <span className={`text-sm ${config.color} mt-0.5`}>{config.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary truncate">
                      {getEventDescription(event)}
                    </p>
                  </div>
                  <span className="text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {formatRelativeTime(event.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
