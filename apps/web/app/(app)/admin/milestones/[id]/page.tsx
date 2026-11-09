import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import { getEnv, getPolicy } from "@ahadi/core/env";
import { getDb, milestones } from "@ahadi/db";
import { getPromiseDetail } from "@ahadi/services";
import { MilestoneStatusBadge } from "@/components/promise/status-badge";
import { Alert } from "@/components/ui";
import { actorFor, requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { orNotFound } from "@/lib/page";
import { VerdictForm } from "./verdict-form";

export const metadata: Metadata = { title: "Manual verdict" };

export default async function ManualVerdictPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const [row] = await getDb().select({ promiseId: milestones.promiseId }).from(milestones).where(eq(milestones.id, id));
  const d = await orNotFound(async () => {
    if (!row) throw new AppError("NOT_FOUND", "Milestone not found");
    return getPromiseDetail(actorFor(admin), row.promiseId);
  });
  const m = d.milestones.find((x) => x.id === id)!;
  const policy = getPolicy(getEnv());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/promises/${d.promise.id}`} className="text-sm text-ink-muted hover:text-ink">
        ← {d.promise.title}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Manual verdict</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          Milestone {m.position}: {m.title} · {formatMoney(m.amountMinor, d.promise.currency)} <MilestoneStatusBadge state={m.state} />
        </p>
      </div>
      <Alert tone="info" title="Phase 1 tool">
        You decide each criterion as a human reviewer. The settlement engine computes the release, then the worker captures it through PayPal (with
        <code className="mx-1">final_capture</code>) and pays the worker. Verifier agents replace this in Phase 3.
      </Alert>
      {m.state !== "FUNDED" ? (
        <Alert tone="warn" title="Not available">The milestone must be funded (it is {m.state.toLowerCase().replace("_", " ")}).</Alert>
      ) : (
        <VerdictForm
          milestoneId={m.id}
          promiseId={d.promise.id}
          amountMinor={m.amountMinor}
          currency={d.promise.currency}
          policy={{ platformFeeBps: policy.platformFeeBps, humanConfirmAboveMinor: policy.humanConfirmAboveMinor, minAutoConfidence: policy.minAutoConfidence }}
          criteria={m.criteria.map((c) => ({ key: c.key, title: c.spec.title, description: c.spec.description, weight: c.weight, required: c.required, partialCredit: c.spec.partialCredit }))}
        />
      )}
    </div>
  );
}
