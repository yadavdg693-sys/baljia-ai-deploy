'use client';

import { useState, useEffect, useCallback } from 'react';

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface Criterion {
  id: string;
  title: string;
  is_met: boolean;
  auto_evaluatable: boolean;
  met_at: string | null;
}

interface Milestone {
  id: string;
  phase: number;
  sort_order: number;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  night_shift_hint: string | null;
  suggested_task_tags: string[];
  criteria: Criterion[];
}

interface Roadmap {
  id: string;
  archetype: string;
  title: string;
  status: string;
  current_phase: number;
  total_phases: number;
}

interface RoadmapData {
  roadmap: Roadmap;
  milestones: Milestone[];
}

// ══════════════════════════════════════════════
// STATUS ICONS (inline SVG to avoid deps)
// ══════════════════════════════════════════════

function StatusIcon({ status }: { status: Milestone['status'] }) {
  switch (status) {
    case 'completed':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-emerald-400 shrink-0">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-baljia-gold shrink-0">
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'skipped':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-text-muted shrink-0">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
          <path d="M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default: // pending
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-text-muted/40 shrink-0">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
  }
}

// ══════════════════════════════════════════════
// ROADMAP RAIL COMPONENT
// ══════════════════════════════════════════════

interface RoadmapRailProps {
  companyId: string;
}

export function RoadmapRail({ companyId }: RoadmapRailProps) {
  const [data, setData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRoadmap = useCallback(async () => {
    try {
      const res = await fetch(`/api/roadmap/${companyId}`);
      if (!res.ok) throw new Error('Failed to fetch roadmap');
      const json = await res.json();
      if (json.roadmap) {
        setData(json);
        // Auto-expand first in_progress milestone
        const active = json.milestones?.find((m: Milestone) => m.status === 'in_progress');
        if (active) setExpandedMilestone(active.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchRoadmap();
  }, [fetchRoadmap]);

  if (loading) {
    return (
      <div className="rounded-xl bg-surface-card border border-border-default p-4">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Roadmap</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-surface-secondary rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl bg-surface-card border border-border-default p-4">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Roadmap</h3>
        <p className="text-xs text-text-muted">
          {error ? 'Could not load roadmap' : 'No roadmap yet. Complete onboarding to generate one.'}
        </p>
      </div>
    );
  }

  const { roadmap, milestones } = data;
  const completedCount = milestones.filter((m) => m.status === 'completed').length;
  const progressPct = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;

  // Group milestones by phase
  const phases = new Map<number, Milestone[]>();
  for (const m of milestones) {
    const existing = phases.get(m.phase) ?? [];
    existing.push(m);
    phases.set(m.phase, existing);
  }

  const phaseNames = ['', 'Foundation', 'Core Product', 'Monetization', 'Growth', 'Scale'];

  return (
    <div className="rounded-xl bg-surface-card border border-border-default p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Roadmap</h3>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-baljia-gold/10 text-baljia-gold capitalize">
          {roadmap.archetype}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
          <span>Phase {roadmap.current_phase}/{roadmap.total_phases}</span>
          <span>{progressPct}% complete</span>
        </div>
        <div className="h-1.5 bg-surface-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-baljia-gold to-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Phase groups */}
      <div className="space-y-4">
        {Array.from(phases.entries()).map(([phase, phaseMilestones]) => {
          const isCurrentPhase = phase === roadmap.current_phase;
          const isPastPhase = phase < roadmap.current_phase;
          const isFuturePhase = phase > roadmap.current_phase;

          return (
            <div key={phase}>
              {/* Phase label */}
              <div className={`flex items-center gap-1.5 mb-1.5 ${isFuturePhase ? 'opacity-40' : ''}`}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {phaseNames[phase] ?? `Phase ${phase}`}
                </span>
                {isCurrentPhase && (
                  <span className="text-[9px] px-1 py-px rounded bg-baljia-gold/20 text-baljia-gold font-medium">
                    Current
                  </span>
                )}
              </div>

              {/* Milestones in this phase */}
              <div className="space-y-1">
                {phaseMilestones.map((milestone, idx) => {
                  const isExpanded = expandedMilestone === milestone.id;
                  const metCriteria = milestone.criteria.filter((c) => c.is_met).length;
                  const totalCriteria = milestone.criteria.length;

                  return (
                    <div key={milestone.id}>
                      {/* Milestone row */}
                      <button
                        onClick={() => setExpandedMilestone(isExpanded ? null : milestone.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors group
                          ${isExpanded ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/50'}
                          ${isFuturePhase ? 'opacity-50' : ''}
                        `}
                      >
                        {/* Connector line */}
                        {idx > 0 && (
                          <div className="absolute -mt-3 ml-[8px] w-px h-2 bg-border-default" />
                        )}
                        <StatusIcon status={milestone.status} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${
                            milestone.status === 'completed' ? 'text-text-muted line-through' :
                            milestone.status === 'in_progress' ? 'text-text-primary' :
                            'text-text-secondary'
                          }`}>
                            {milestone.title}
                          </p>
                        </div>
                        {totalCriteria > 0 && (
                          <span className="text-[10px] text-text-muted shrink-0">
                            {metCriteria}/{totalCriteria}
                          </span>
                        )}
                      </button>

                      {/* Expanded criteria */}
                      {isExpanded && milestone.criteria.length > 0 && (
                        <div className="ml-7 mt-1 mb-2 space-y-1">
                          {milestone.description && (
                            <p className="text-[10px] text-text-muted mb-2 leading-relaxed">
                              {milestone.description}
                            </p>
                          )}
                          {milestone.criteria.map((criterion) => (
                            <div
                              key={criterion.id}
                              className="flex items-center gap-1.5 text-[11px]"
                            >
                              {criterion.is_met ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-emerald-400 shrink-0">
                                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-text-muted/40 shrink-0">
                                  <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
                                </svg>
                              )}
                              <span className={criterion.is_met ? 'text-text-muted line-through' : 'text-text-secondary'}>
                                {criterion.title}
                              </span>
                            </div>
                          ))}
                          {/* Tags */}
                          {milestone.suggested_task_tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {milestone.suggested_task_tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[9px] px-1.5 py-0.5 rounded-md bg-surface-primary border border-border-default text-text-muted"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Roadmap status footer */}
      {roadmap.status === 'completed' && (
        <div className="mt-4 text-center">
          <p className="text-xs font-medium text-emerald-400">🎉 Roadmap Complete!</p>
        </div>
      )}
    </div>
  );
}
