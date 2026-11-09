import type { Metadata } from "next";
import Link from "next/link";
import { getPromiseLedger } from "@ahadi/services";
import { Alert, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatDateTime, shortHash } from "@/lib/format";
import { orNotFound } from "@/lib/page";
import { VerifyChainButton } from "./verify-chain-button";

export const metadata: Metadata = { title: "Evidence ledger" };

function actorLabel(a: string) {
  if (a === "paypal") return "PayPal";
  if (a === "system") return "Ahadi";
  if (a.startsWith("admin:")) return "Admin";
  if (a.startsWith("user:")) return "Party";
  if (a.startsWith("agent:")) return "Agent";
  return a;
}

export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/promises/${id}/ledger`);
  const { promise, events, verification } = await orNotFound(() => getPromiseLedger(actorFor(user), id));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/promises/${id}`} className="text-sm text-ink-muted hover:text-ink">
        ← {promise.title}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evidence ledger</h1>
          <p className="mt-1 text-sm text-ink-muted">Every step is hash-chained to the one before it. Editing any event breaks the chain.</p>
        </div>
        <VerifyChainButton promiseId={id} />
      </div>

      {verification.valid ? (
        <Alert tone="brand" title={`Chain intact · ${verification.length} events`}>
          Head hash <span className="break-all font-mono text-xs">{verification.headHash}</span>
        </Alert>
      ) : (
        <Alert tone="danger" title={`Chain broken at event #${verification.brokenAt}`}>
          {verification.reason}. This history has been tampered with.
        </Alert>
      )}

      {events.length === 0 ? (
        <EmptyState title="No events yet" />
      ) : (
        <Card>
          <CardHeader title="Timeline" description="Oldest first · times in Nairobi (EAT)" />
          <CardBody>
            <ol className="relative space-y-5 border-l border-line pl-6">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[31px] top-1 flex size-4 items-center justify-center rounded-full border-2 border-surface bg-brand-500" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tabular font-mono text-xs text-ink-subtle">#{e.seq}</span>
                    <span className="font-medium">{e.type}</span>
                    <span className="text-xs text-ink-muted">
                      {actorLabel(e.actor)} · {formatDateTime(e.createdAt)}
                    </span>
                  </div>
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer text-xs text-ink-subtle">
                      hash {shortHash(e.hash, 16)} · prev {shortHash(e.prevHash, 10)}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-canvas p-3 text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
