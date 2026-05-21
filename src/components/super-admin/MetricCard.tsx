type Props = {
  label: string;
  value: string | number;
  hint?: string;
};

export function MetricCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-md border border-[#dedbd2] bg-white p-4">
      <p className="text-sm text-[#6b6b60]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#777]">{hint}</p> : null}
    </div>
  );
}
