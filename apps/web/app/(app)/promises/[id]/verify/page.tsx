import type { Metadata } from "next";
import Link from "next/link";
import { getEnv } from "@ahadi/core/env";
import { getPromiseDetail, getVerificationView } from "@ahadi/services";
import { Alert } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/page";
import { LiveVerification } from "./live-verification";

export const metadata: Metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ milestone?: string }>;
}) {
  const { id } = await params;
  const { milestone } = await searchParams;
  const user = await requireUser(`/promises/${id}/verify`);
  const actor = actorFor(user);
  const d = await orNotFound(() => getPromiseDetail(actor, id));
  const m =
    d.milestones.find((x) => x.id === milestone) ??
    d.milestones.find((x) => x.latestSubmission) ??
    d.milestones[0];
  const back = (
    <Link href={`/promises/${id}`} className="text-sm text-ink-muted hover:text-ink">
      ← {d.promise.title}
    </Link>
  );
  if (!m?.latestSubmission)
    return (
      <div className="space-y-4">
        {back}
        <Alert tone="info" title="No submission yet">
          Verification starts when the worker submits.
        </Alert>
      </div>
    );
  const initial = await getVerificationView(actor, m.id);
  const env = getEnv();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {back}
      <LiveVerification initial={JSON.parse(JSON.stringify(initial))} kesPerUsd={env.KES_PER_USD} />
    </div>
  );
}
