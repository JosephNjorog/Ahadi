import type { ReactNode } from "react";

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]">
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
