// Mascot State Machine — drives the Baljia Angel status
// Domain 10.2: State-driven, not decorative
// States: listening, planning, running, investigating, blocked, resolved, growth_mode
// Driven by real platform events from the same event system

import type { BaljiaState } from '@/types';

// ══════════════════════════════════════════════
// STATE TRANSITIONS — event-driven
// ══════════════════════════════════════════════

interface MascotState {
  state: BaljiaState;
  label: string;
  description: string;
  emotion: 'neutral' | 'focused' | 'working' | 'curious' | 'concerned' | 'happy' | 'confident';
  glowColor: string;
}

const STATE_MAP: Record<BaljiaState, MascotState> = {
  listening: {
    state: 'listening',
    label: 'Listening',
    description: 'Waiting for your next move',
    emotion: 'neutral',
    glowColor: '#6366f1', // Indigo
  },
  planning: {
    state: 'planning',
    label: 'Planning',
    description: 'Thinking through the next steps',
    emotion: 'focused',
    glowColor: '#8b5cf6', // Violet
  },
  running: {
    state: 'running',
    label: 'Running',
    description: 'Executing tasks right now',
    emotion: 'working',
    glowColor: '#f59e0b', // Amber
  },
  investigating: {
    state: 'investigating',
    label: 'Investigating',
    description: 'Looking into something unusual',
    emotion: 'curious',
    glowColor: '#06b6d4', // Cyan
  },
  blocked: {
    state: 'blocked',
    label: 'Blocked',
    description: 'Needs your input to continue',
    emotion: 'concerned',
    glowColor: '#ef4444', // Red
  },
  resolved: {
    state: 'resolved',
    label: 'Resolved',
    description: 'Just finished something',
    emotion: 'happy',
    glowColor: '#22c55e', // Green
  },
  growth_mode: {
    state: 'growth_mode',
    label: 'Growth Mode',
    description: 'Growing your business',
    emotion: 'confident',
    glowColor: '#f97316', // Orange
  },
};

// Size tokens (Domain 10.2)
export const MASCOT_SIZES = {
  chat: 40,
  header: 48,
  dashboard: 112,
  live_wall: 152,
  hero: 220,
} as const;

// ══════════════════════════════════════════════
// EVENT → STATE MAPPING
// ══════════════════════════════════════════════

type PlatformEventType =
  | 'task_created' | 'task_started' | 'task_completed' | 'task_failed'
  | 'task_approved' | 'task_rejected' | 'credits_depleted'
  | 'night_shift_started' | 'night_shift_completed'
  | 'chat_message';

export function eventToState(eventType: string): BaljiaState {
  switch (eventType as PlatformEventType) {
    case 'chat_message':
      return 'listening';
    case 'task_created':
    case 'task_approved':
      return 'planning';
    case 'task_started':
    case 'night_shift_started':
      return 'running';
    case 'task_failed':
      return 'investigating';
    case 'credits_depleted':
    case 'task_rejected':
      return 'blocked';
    case 'task_completed':
    case 'night_shift_completed':
      return 'resolved';
    default:
      return 'listening';
  }
}

// ══════════════════════════════════════════════
// STATE MACHINE — manages transitions
// ══════════════════════════════════════════════

export class MascotStateMachine {
  private currentState: BaljiaState;
  private lastTransition: number;
  private resolvedTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(initialState: BaljiaState = 'listening') {
    this.currentState = initialState;
    this.lastTransition = Date.now();
  }

  getState(): MascotState {
    return STATE_MAP[this.currentState];
  }

  getCurrentStateName(): BaljiaState {
    return this.currentState;
  }

  getTimeSinceTransition(): number {
    return Date.now() - this.lastTransition;
  }

  transition(event: string): MascotState {
    const newState = eventToState(event);

    // Clear any pending auto-transition
    if (this.resolvedTimeout) {
      clearTimeout(this.resolvedTimeout);
      this.resolvedTimeout = null;
    }

    this.currentState = newState;
    this.lastTransition = Date.now();

    // Auto-transition from resolved → listening after 10s
    if (newState === 'resolved') {
      this.resolvedTimeout = setTimeout(() => {
        this.currentState = 'listening';
        this.lastTransition = Date.now();
      }, 10000);
    }

    return STATE_MAP[this.currentState];
  }

  // Check if any tasks are running for a company
  async inferStateFromDB(companyId: string): Promise<MascotState> {
    const { db, tasks } = await import('@/lib/db');
    const { eq, and, inArray, gte } = await import('drizzle-orm');

    // Check for running tasks
    const running = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.company_id, companyId), eq(tasks.status, 'in_progress'))).limit(1);

    if (running.length) {
      this.currentState = 'running';
      return STATE_MAP.running;
    }

    // Check for blocked tasks
    const blocked = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.company_id, companyId), eq(tasks.status, 'blocked'))).limit(1);

    if (blocked.length) {
      this.currentState = 'blocked';
      return STATE_MAP.blocked;
    }

    // Check recent completions (within 10s)
    const recent = await db.select({ id: tasks.id }).from(tasks)
      .where(and(
        eq(tasks.company_id, companyId),
        inArray(tasks.status, ['completed_verified', 'completed_unverified']),
        gte(tasks.completed_at, new Date(Date.now() - 10000))
      )).limit(1);

    if (recent.length) {
      this.currentState = 'resolved';
      return STATE_MAP.resolved;
    }

    // Default to listening
    this.currentState = 'listening';
    return STATE_MAP.listening;
  }
}

export { STATE_MAP };
export type { MascotState };
