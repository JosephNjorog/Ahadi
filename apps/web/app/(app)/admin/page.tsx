import type { Metadata } from "next";
import Link from "next/link";
import { getEnv, paypalConfigured } from "@ahadi/core/env";
import { getAdminOverview, listReviewQueue, listRiskFlags, recentAgentRuns } from "@ahadi/services";
import { ResolveRiskButton } from "./resolve-risk-button";
import { MilestoneStatusBadge } from "@/components/promise/status-badge";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ResolveJobButton } from "./resolve-job-button";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();
  const env = getEnv();
  const [o, queue, flags, runs] = await Promise.all([
    getAdminOverview(),
    listReviewQueue(),
    listRiskFlags(50),
    recentAgentRuns(30),
  ]);
  const openFlags = flags.filter((f) => !f.resolvedAt);
  const m = o.money;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Money map, review queue, risk flags, PayPal state and agent activity.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/admin/ledger"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-raised"
          >
            Ledger grid
          </Link>
          <Link
            href="/admin/ops"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-raised"
          >
            Ops Agent
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader
            title="Review queue"
            description="Milestones waiting for a human, in mediation, or failed to settle"
          />
          {queue.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">Nothing is waiting.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {queue.map((q) => (
                <li
                  key={q.milestoneId}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                >
                  <Link
                    href={
                      q.state === "MEDIATING" || q.state === "ESCALATED"
                        ? `/promises/${q.promiseId}/mediation?milestone=${q.milestoneId}`
                        : q.state === "NEEDS_HUMAN"
                          ? `/promises/${q.promiseId}/verify?milestone=${q.milestoneId}`
                          : `/promises/${q.promiseId}`
                    }
                    className="min-w-0 font-medium hover:underline"
                  >
                    {q.promiseTitle} · {q.title}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="tabular">{formatMoney(q.amountMinor, q.currency)}</span>
                    <MilestoneStatusBadge state={q.state} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader
            title="Risk flags"
            description={`${openFlags.length} open · HOLD_PAYOUT pauses payouts until resolved`}
          />
          {openFlags.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">No open flags.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {openFlags.map((f) => {
                const d = f.detail as { detail?: string; summary?: string; reasons?: string[] };
                return (
                  <li key={f.id} className="space-y-1 px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Badge
                          tone={
                            f.severity === "high" ? "danger" : f.severity === "medium" ? "warn" : "neutral"
                          }
                        >
                          {f.code}
                        </Badge>
                        <span className="text-xs text-ink-subtle">
                          {f.subjectType} {f.subjectId.slice(0, 8)} · {formatDateTime(f.createdAt)}
                        </span>
                      </span>
                      <ResolveRiskButton id={f.id} />
                    </div>
                    <p className="text-ink-muted">{d.detail ?? d.summary ?? (d.reasons ?? []).join("; ")}</p>
                    {f.subjectType === "promise" ? (
                      <Link
                        href={`/promises/${f.subjectId}`}
                        className="text-xs text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                      >
                        Open promise
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {!paypalConfigured(env) ? (
        <Alert tone="danger" title="PayPal is not configured">
          Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (see docs/SETUP.md).
        </Alert>
      ) : !env.PAYPAL_WEBHOOK_ID ? (
        <Alert tone="warn" title="PayPal webhook not registered">
          Run <code>npm run paypal:webhook</code> and set PAYPAL_WEBHOOK_ID. Until then, funding works through
          the API path only.
        </Alert>
      ) : null}

      <section aria-label="Money map" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Authorized" value={formatMoney(m.authorizedMinor)} hint="all holds ever" />
        <Stat label="Held now" value={formatMoney(m.heldMinor)} hint="uncaptured" />
        <Stat label="Captured" value={formatMoney(m.capturedMinor)} />
        <Stat label="Voided" value={formatMoney(m.voidedMinor)} hint="returned to payer" />
        <Stat label="Paid out" value={formatMoney(m.paidOutMinor)} hint="to workers" />
        <Stat label="PayPal fees" value={formatMoney(m.paypalFeesMinor)} />
      </section>

      <Card className="overflow-hidden">
        <CardHeader title="Fundings" description="Latest 50 PayPal orders and authorizations" />
        {o.fundings.length === 0 ? (
          <CardBody>
            <EmptyState title="No fundings yet">Sign in as the client and fund the demo promise.</EmptyState>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Milestone</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Funding</th>
                  <th className="px-4 py-2 font-medium">Authorization</th>
                  <th className="px-4 py-2 font-medium">Expires</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {o.fundings.map(({ f, m: ms }) => (
                  <tr key={f.id}>
                    <td className="px-4 py-2">
                      <Link href={`/promises/${ms.promiseId}`} className="font-medium hover:underline">
                        {ms.title}
                      </Link>
                      <div className="mt-0.5">
                        <MilestoneStatusBadge state={ms.state} />
                      </div>
                    </td>
                    <td className="tabular px-4 py-2">{formatMoney(f.amountMinor, f.currency)}</td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          f.status === "AUTHORIZED" || f.status === "REAUTHORIZED"
                            ? "brand"
                            : f.status === "CANCELLED"
                              ? "neutral"
                              : "info"
                        }
                      >
                        {f.status.toLowerCase()}
                      </Badge>
                      <div className="mt-0.5 font-mono text-xs text-ink-subtle">{f.paypalOrderId}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{f.paypalAuthorizationId ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">{formatDateTime(f.expiresAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {ms.state === "FUNDED" ? (
                        <Link
                          href={`/admin/milestones/${ms.id}`}
                          className="text-sm font-medium text-ink underline-offset-4 hover:underline"
                        >
                          Manual verdict →
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Settlements" />
          {o.settlements.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">None yet.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {o.settlements.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <Badge tone={s.status === "PAID" ? "brand" : s.status === "FAILED" ? "danger" : "info"}>
                      {s.status.toLowerCase()}
                    </Badge>
                    <span className="ml-2 font-mono text-xs text-ink-subtle">
                      {s.paypalCaptureId ?? "no capture"}
                    </span>
                  </div>
                  <span className="tabular">
                    {formatMoney(s.capturedMinor ?? 0)}{" "}
                    <span className="text-ink-subtle">(fee {formatMoney(s.paypalFeeMinor ?? 0)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Payouts" />
          {o.payouts.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-muted">None yet.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {o.payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate">{p.recipientPaypalEmail}</p>
                    <p className="font-mono text-xs text-ink-subtle">
                      {p.paypalPayoutBatchId ?? p.senderBatchId}
                    </p>
                  </div>
                  <span className="tabular flex items-center gap-2">
                    {formatMoney(p.amountMinor, p.currency)}
                    <Badge
                      tone={p.status === "SUCCESS" ? "brand" : p.status === "PENDING" ? "info" : "danger"}
                    >
                      {p.status.toLowerCase()}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Agent runs"
          description="Latest model calls: agent, prompt version, model, tokens and latency (SPEC §24)"
        />
        {runs.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-muted">No model calls yet.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Tokens in/out</th>
                  <th className="px-4 py-2 font-medium">Latency</th>
                  <th className="px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      {r.agent} <span className="text-xs text-ink-subtle">v{r.promptVersion}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                    <td className="px-4 py-2">
                      <Badge tone={r.status === "ok" ? "brand" : "danger"}>{r.status}</Badge>
                      {r.attempts > 1 ? (
                        <span className="ml-1 text-xs text-ink-subtle">×{r.attempts}</span>
                      ) : null}
                    </td>
                    <td className="tabular px-4 py-2 text-xs">
                      {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                    </td>
                    <td className="tabular px-4 py-2 text-xs">{(r.latencyMs / 1000).toFixed(1)}s</td>
                    <td className="px-4 py-2 text-xs">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Failed webhooks" description="Verified events whose processing threw" />
          <CardBody>
            {o.failedWebhooks.length === 0 ? (
              <p className="text-sm text-ink-muted">All webhook events processed.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {o.failedWebhooks.map((w) => (
                  <li key={w.id} className="rounded-lg border border-line px-3 py-2">
                    <p className="font-medium">{w.eventType}</p>
                    <p className="font-mono text-xs text-ink-subtle">{w.id}</p>
                    <p className="mt-1 text-danger-600">{w.error}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Dead-lettered jobs"
            description="Jobs that exhausted retries or hit a business-rule error"
          />
          <CardBody>
            {o.deadJobs.length === 0 ? (
              <p className="text-sm text-ink-muted">No failed jobs.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {o.deadJobs.map((j) => (
                  <li key={j.id} className="rounded-lg border border-line px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{j.jobName}</p>
                      <ResolveJobButton id={j.id} />
                    </div>
                    <p className="text-xs text-ink-subtle">
                      {formatDateTime(j.createdAt)} · {j.attempts} attempts
                    </p>
                    <p className="mt-1 text-danger-600">{j.error}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
