import type { Metadata } from "next";
import Link from "next/link";
import { getEnv } from "@ahadi/core/env";
import { getPromiseDetail } from "@ahadi/services";
import { MilestoneCard } from "@/components/promise/milestone-card";
import { PromiseStatusBadge } from "@/components/promise/status-badge";
import { Badge, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, shortHash } from "@/lib/format";
import { orNotFound } from "@/lib/page";

export const metadata: Metadata = { title: "Promise" };

export default async function PromisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/promises/${id}`);
  const d = await orNotFound(() => getPromiseDetail(actorFor(user), id));
  const env = getEnv();
  const { promise: p, terms, signatures } = d;
  const total = d.milestones.reduce((s, m) => s + m.amountMinor, 0);
  const signed = (party: "client" | "worker") => signatures.find((s) => s.party === party);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-ink-muted hover:text-ink">
          ← All promises
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
              <PromiseStatusBadge state={p.state} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {p.category} · {d.client?.displayName ?? "—"} →{" "}
              {d.worker?.displayName ?? "worker not invited yet"} ·{" "}
              {d.role ? `you are the ${d.role}` : "admin view"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="tabular text-2xl font-semibold">{formatMoney(total, p.currency)}</p>
            <ButtonLink href={`/promises/${p.id}/ledger`} variant="secondary" size="sm">
              Evidence ledger
            </ButtonLink>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {d.milestones.map((m) => (
          <MilestoneCard
            key={m.id}
            m={m}
            promiseId={p.id}
            currency={p.currency}
            role={d.role}
            isAdmin={d.viewerIsAdmin}
            kesPerUsd={env.KES_PER_USD}
            platformFeeBps={env.PLATFORM_FEE_BPS}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Signed terms"
            description={
              terms ? `Version ${terms.version} · ${formatDateTime(terms.createdAt)}` : "Not drafted yet"
            }
          />
          <CardBody className="space-y-3 text-sm">
            {terms ? (
              <>
                <p className="text-ink-muted">{terms.body.scopeSummary}</p>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Terms hash (SHA-256)
                  </p>
                  <p className="mt-1 break-all font-mono text-xs">{terms.bodyHash}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["client", "worker"] as const).map((party) => {
                    const s = signed(party);
                    return (
                      <div key={party} className="rounded-lg border border-line px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{party}</p>
                        {s ? (
                          <p className="mt-0.5 flex flex-wrap items-center gap-2">
                            <Badge tone={s.bodyHash === terms.bodyHash ? "brand" : "danger"}>
                              {s.bodyHash === terms.bodyHash ? "Signed" : "Hash mismatch"}
                            </Badge>
                            <span className="text-xs text-ink-muted">{formatDateTime(s.signedAt)}</span>
                          </p>
                        ) : (
                          <p className="mt-0.5 text-ink-muted">Not signed</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {terms.body.outOfScope.length ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      Out of scope
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-ink-muted">
                      {terms.body.outOfScope.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {terms.body.assumptions.length ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Assumptions</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-muted">
                      {terms.body.assumptions.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-ink-muted">The contract builder arrives in Phase 2.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Original brief" description="As written by the client" />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-ink-muted">{p.sourceBrief ?? "—"}</p>
            <p className="mt-4 text-xs text-ink-subtle">
              Promise {shortHash(p.id, 8)} · created {formatDateTime(p.createdAt)}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
