import type { Metadata } from "next";
import Link from "next/link";
import { listPromisesForActor } from "@ahadi/services";
import { MilestoneStatusBadge, PromiseStatusBadge } from "@/components/promise/status-badge";
import { Badge, ButtonLink, Card, EmptyState, Stat } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Promises" };

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  const promises = await listPromisesForActor(actorFor(user));
  const asClient = promises.filter((p) => p.role === "client");
  const asWorker = promises.filter((p) => p.role === "worker");
  const held = promises.reduce((s, p) => s + p.heldMinor, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your promises</h1>
          <p className="mt-1 text-sm text-ink-muted">Every job is a promise: signed criteria, PayPal-secured funds, verified release.</p>
        </div>
        <span title="AI contract builder arrives in Phase 2">
          <ButtonLink href="#" variant="secondary" className="pointer-events-none opacity-60">
            New promise · soon
          </ButtonLink>
        </span>
      </div>

      {!user.paypalEmail ? (
        <div className="rounded-xl border border-warn-600/25 bg-warn-50 px-4 py-3 text-sm">
          <strong>Add your PayPal email</strong> so you can be paid when you work on promises.{" "}
          <Link href="/settings" className="font-medium text-brand-700 underline">
            Go to settings
          </Link>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="As client" value={asClient.length} hint="promises you fund" />
        <Stat label="As worker" value={asWorker.length} hint="promises you deliver" />
        <Stat label="Held by PayPal" value={formatMoney(held)} hint="authorized, not captured" />
      </div>

      {promises.length === 0 ? (
        <EmptyState title="No promises yet" icon={<span className="text-3xl">🤝</span>}>
          When someone invites you to a promise, or you create one, it shows up here. In the demo, run <code className="rounded bg-canvas px-1">npm run db:seed</code> and sign in as the client.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {promises.map((p) => (
              <li key={p.id}>
                <Link href={`/promises/${p.id}`} className="flex flex-col gap-3 px-5 py-4 hover:bg-canvas sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-ink">{p.title}</p>
                      <PromiseStatusBadge state={p.state} />
                      {p.role ? <Badge tone="neutral">{p.role === "client" ? "You're the client" : "You're the worker"}</Badge> : <Badge tone="info">Admin view</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      {p.category} · {p.role === "client" ? `Worker: ${p.worker?.displayName ?? "invited"}` : `Client: ${p.client?.displayName ?? "—"}`} · created {formatDate(p.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.milestones.map((m) => (
                        <span key={m.id} className="inline-flex items-center gap-2 text-xs text-ink-muted">
                          M{m.position} <MilestoneStatusBadge state={m.state} />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="tabular text-lg font-semibold">{formatMoney(p.totalMinor, p.currency)}</p>
                    {p.heldMinor > 0 ? <p className="text-xs text-brand-700">{formatMoney(p.heldMinor, p.currency)} secured</p> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
