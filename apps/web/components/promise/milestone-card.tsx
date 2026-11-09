import { bpsToPercent } from "@ahadi/core/money";
import { estimateMpesaKes } from "@ahadi/core/settlement";
import type { MilestoneState } from "@ahadi/core/state";
import type { PromiseDetail } from "@ahadi/services";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { formatDateTime, formatMoney, relativeTime } from "@/lib/format";
import { METHOD_LABEL, MILESTONE_STATUS } from "@/lib/status";
import { AdminSettlementActions } from "./admin-settlement-actions";
import { MilestoneStatusBadge } from "./status-badge";

type M = PromiseDetail["milestones"][number];

const OUTCOME_TONE = { pass: "brand", partial: "warn", fail: "danger", undetermined: "neutral" } as const;

export function MilestoneCard({
  m,
  promiseId,
  currency,
  role,
  isAdmin,
  kesPerUsd,
  platformFeeBps,
}: {
  m: M;
  promiseId: string;
  currency: string;
  role: "client" | "worker" | null;
  isAdmin: boolean;
  kesPerUsd: number;
  platformFeeBps: number;
}) {
  const status = MILESTONE_STATUS[m.state as MilestoneState];
  const guidance = role === "worker" ? status?.worker : status?.client;
  const resultByCriterion = new Map(m.results.map((r) => [r.criterionId, r]));
  const canFund = role === "client" && (m.state === "UNFUNDED" || m.state === "FUNDING");
  const f = m.funding;
  const secured = f && (f.status === "AUTHORIZED" || f.status === "REAUTHORIZED");
  const p = m.proposal;
  const s = m.settlement;
  const paidOut = m.payouts.reduce((sum, x) => sum + x.amountMinor, 0);

  return (
    <Card as="article" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Milestone {m.position}</p>
          <h3 className="mt-0.5 text-lg font-semibold">{m.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <MilestoneStatusBadge state={m.state} />
            {m.dueAt ? <span>Due {formatDateTime(m.dueAt)}</span> : null}
            <span>
              Attempts {m.attemptsUsed}/{m.maxAttempts}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="tabular text-2xl font-semibold">{formatMoney(m.amountMinor, currency)}</p>
          {secured ? <p className="text-xs font-medium text-brand-700">Secured by PayPal</p> : null}
        </div>
      </div>

      {guidance ? <p className="border-b border-line bg-canvas px-5 py-3 text-sm text-ink-muted">{guidance}</p> : null}

      <div className="grid gap-0 lg:grid-cols-5">
        <div className="border-line px-5 py-4 lg:col-span-3 lg:border-r">
          <h4 className="text-sm font-semibold">Acceptance criteria</h4>
          <ul className="mt-3 space-y-3">
            {m.criteria.map((c) => {
              const r = resultByCriterion.get(c.id);
              return (
                <li key={c.id} className="rounded-lg border border-line px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-subtle">{c.key}</span>
                    <span className="text-sm font-medium">{c.spec.title}</span>
                    <Badge tone="neutral">{METHOD_LABEL[c.spec.method]}</Badge>
                    {c.required ? <Badge tone="warn">Required</Badge> : null}
                    {c.spec.partialCredit ? <Badge tone="info">Partial credit</Badge> : null}
                    <span className="tabular ml-auto text-xs text-ink-muted">weight {c.weight}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{c.spec.description}</p>
                  {r ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={OUTCOME_TONE[r.outcome]}>
                        {r.outcome}
                        {r.outcome === "partial" ? ` ${Math.round(r.credit * 100)}%` : ""}
                      </Badge>
                      <span className="text-xs text-ink-subtle">
                        by {r.decidedBy} · confidence {Math.round(r.confidence * 100)}%
                      </span>
                      <span className="w-full text-ink-muted">{r.reasoning}</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-4 px-5 py-4 lg:col-span-2">
          <section>
            <h4 className="text-sm font-semibold">Funding</h4>
            {!f ? (
              <p className="mt-1 text-sm text-ink-muted">No PayPal order yet.</p>
            ) : (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-subtle">Status</dt>
                <dd>{f.status.toLowerCase().replace("_", " ")}</dd>
                <dt className="text-ink-subtle">Order</dt>
                <dd className="truncate font-mono text-xs leading-5">{f.paypalOrderId}</dd>
                {f.paypalAuthorizationId ? (
                  <>
                    <dt className="text-ink-subtle">Authorization</dt>
                    <dd className="truncate font-mono text-xs leading-5">{f.paypalAuthorizationId}</dd>
                  </>
                ) : null}
                {secured && f.honorExpiresAt ? (
                  <>
                    <dt className="text-ink-subtle">Honor period</dt>
                    <dd>{new Date(f.honorExpiresAt) > new Date() ? `ends ${relativeTime(f.honorExpiresAt)}` : "ended — Ahadi reauthorizes automatically"}</dd>
                  </>
                ) : null}
                {secured && f.expiresAt ? (
                  <>
                    <dt className="text-ink-subtle">Hold expires</dt>
                    <dd>{formatDateTime(f.expiresAt)}</dd>
                  </>
                ) : null}
              </dl>
            )}
            {canFund ? (
              <ButtonLink href={`/promises/${promiseId}/fund?milestone=${m.id}`} className="mt-3 w-full">
                {m.state === "FUNDING" ? "Continue funding with PayPal" : `Fund ${formatMoney(m.amountMinor, currency)} with PayPal`}
              </ButtonLink>
            ) : null}
            {isAdmin && m.state === "FUNDED" ? (
              <ButtonLink href={`/admin/milestones/${m.id}`} variant="secondary" className="mt-3 w-full">
                Admin: record manual verdict
              </ButtonLink>
            ) : null}
          </section>

          {p ? (
            <section className="border-t border-line pt-4">
              <h4 className="text-sm font-semibold">Proposal</h4>
              <div className="mt-2 rounded-lg bg-canvas px-3 py-3">
                <p className="tabular text-2xl font-semibold">{bpsToPercent(p.releaseBps)}</p>
                <p className="text-sm text-ink-muted">released of {formatMoney(m.amountMinor, currency)}</p>
                <dl className="tabular mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                  <dt className="text-ink-muted">Capture</dt>
                  <dd className="font-medium">{formatMoney(p.captureMinor, currency)}</dd>
                  <dt className="text-ink-muted">Returned to client</dt>
                  <dd>{formatMoney(m.amountMinor - p.captureMinor, currency)}</dd>
                  <dt className="text-ink-muted">Ahadi fee ({bpsToPercent(platformFeeBps)})</dt>
                  <dd>{formatMoney(p.platformFeeMinor, currency)}</dd>
                  <dt className="text-ink-muted">Worker receives (before PayPal fee)</dt>
                  <dd className="font-medium">{formatMoney(p.captureMinor - p.platformFeeMinor, currency)}</dd>
                  {currency === "USD" && p.captureMinor > 0 ? (
                    <>
                      <dt className="text-ink-muted">≈ M-Pesa (estimate)</dt>
                      <dd>KES {estimateMpesaKes(p.captureMinor - p.platformFeeMinor, kesPerUsd).toLocaleString("en-KE")}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
              <p className="mt-2 text-sm text-ink-muted">{p.explanation}</p>
            </section>
          ) : null}

          {s ? (
            <section className="border-t border-line pt-4">
              <h4 className="text-sm font-semibold">Settlement</h4>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-subtle">Status</dt>
                <dd>{s.status.toLowerCase().replace("_", " ")}</dd>
                {s.paypalCaptureId ? (
                  <>
                    <dt className="text-ink-subtle">Capture</dt>
                    <dd className="truncate font-mono text-xs leading-5">{s.paypalCaptureId}</dd>
                  </>
                ) : null}
                {s.capturedMinor != null ? (
                  <>
                    <dt className="text-ink-subtle">Captured</dt>
                    <dd className="tabular">{formatMoney(s.capturedMinor, currency)}</dd>
                  </>
                ) : null}
                {s.paypalFeeMinor != null ? (
                  <>
                    <dt className="text-ink-subtle">PayPal fee</dt>
                    <dd className="tabular">{formatMoney(s.paypalFeeMinor, currency)}</dd>
                  </>
                ) : null}
              </dl>
              {m.payouts.length ? (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Payouts</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {m.payouts.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate">{x.recipientPaypalEmail}</span>
                        <span className="tabular flex items-center gap-2">
                          {formatMoney(x.amountMinor, x.currency)}
                          <Badge tone={x.status === "SUCCESS" ? "brand" : x.status === "PENDING" ? "info" : "danger"}>{x.status.toLowerCase()}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-ink-subtle">Total paid out {formatMoney(paidOut, currency)}</p>
                </div>
              ) : null}
              {isAdmin ? <AdminSettlementActions settlementId={s.id} status={s.status} error={s.error} /> : null}
            </section>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
