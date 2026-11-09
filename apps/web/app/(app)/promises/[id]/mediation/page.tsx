import type { Metadata } from "next";
import Link from "next/link";
import { getMediationView, getPromiseDetail } from "@ahadi/services";
import { Alert, EmptyState } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/page";
import { MediationClient } from "./mediation-client";

export const metadata: Metadata = { title: "Mediation" };
export const dynamic = "force-dynamic";

export default async function MediationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ milestone?: string }>;
}) {
  const { id } = await params;
  const { milestone } = await searchParams;
  const user = await requireUser(`/promises/${id}/mediation`);
  const actor = actorFor(user);
  const d = await orNotFound(() => getPromiseDetail(actor, id));
  const m =
    d.milestones.find((x) => x.id === milestone) ??
    d.milestones.find((x) => ["MEDIATING", "ESCALATED"].includes(x.state)) ??
    d.milestones[0];
  if (!m) return <EmptyState title="No milestones" />;
  const view = await orNotFound(() => getMediationView(actor, m.id));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/promises/${id}`} className="text-sm text-ink-muted hover:text-ink">
        ← {d.promise.title}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mediation · milestone {m.position}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Funds stay held by PayPal while this is open. The Ahadi Mediator reads the signed terms, the
          evidence and both statements, then proposes a resolution you each accept or reject. Two rejections
          escalate.
        </p>
      </div>
      {view.mediations.length === 0 ? (
        <Alert tone="info" title="No mediation for this milestone">
          Mediation opens when either side objects to a proposed release.
        </Alert>
      ) : (
        <MediationClient view={JSON.parse(JSON.stringify(view))} currency={d.promise.currency} />
      )}
    </div>
  );
}
