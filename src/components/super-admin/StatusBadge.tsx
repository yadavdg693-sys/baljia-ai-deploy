const COLORS: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  approved_to_fix: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  full_active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  live: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  owned: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  trial_active: 'border-blue-200 bg-blue-50 text-blue-800',
  initializing: 'border-blue-200 bg-blue-50 text-blue-800',
  keep_live_active: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  open: 'border-blue-200 bg-blue-50 text-blue-800',
  pr_open: 'border-blue-200 bg-blue-50 text-blue-800',
  running: 'border-blue-200 bg-blue-50 text-blue-800',
  awaiting_approval: 'border-amber-200 bg-amber-50 text-amber-800',
  pending_auth: 'border-amber-200 bg-amber-50 text-amber-800',
  past_due: 'border-amber-200 bg-amber-50 text-amber-800',
  todo: 'border-amber-200 bg-amber-50 text-amber-800',
  trialing: 'border-amber-200 bg-amber-50 text-amber-800',
  archived: 'border-stone-200 bg-stone-50 text-stone-700',
  free: 'border-stone-200 bg-stone-50 text-stone-700',
  inactive: 'border-stone-200 bg-stone-50 text-stone-700',
  paused: 'border-stone-200 bg-stone-50 text-stone-700',
  wont_fix: 'border-stone-200 bg-stone-50 text-stone-700',
  cancelled: 'border-red-200 bg-red-50 text-red-800',
  deleted: 'border-red-200 bg-red-50 text-red-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
  failed_permanent: 'border-red-200 bg-red-50 text-red-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  suspended_billing: 'border-red-200 bg-red-50 text-red-800',
  trial_expired: 'border-red-200 bg-red-50 text-red-800',
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const label = value ?? 'unknown';
  const color = COLORS[label] ?? 'border-[#dedbd2] bg-white text-[#555]';
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${color}`}>
      {label.split('_').join(' ')}
    </span>
  );
}
