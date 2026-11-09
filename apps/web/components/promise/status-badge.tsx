import type { MilestoneState, PromiseState } from "@ahadi/core/state";
import { Badge } from "@/components/ui";
import { MILESTONE_STATUS, PROMISE_STATUS } from "@/lib/status";

export function MilestoneStatusBadge({ state }: { state: string }) {
  const s = MILESTONE_STATUS[state as MilestoneState] ?? { label: state, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function PromiseStatusBadge({ state }: { state: string }) {
  const s = PROMISE_STATUS[state as PromiseState] ?? { label: state, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
