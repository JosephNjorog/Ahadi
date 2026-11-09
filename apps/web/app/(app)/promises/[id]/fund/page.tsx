import type { Metadata } from "next";
import Link from "next/link";
import { getPromiseDetail } from "@ahadi/services";
import { FundWithPayPal } from "@/components/paypal/fund-with-paypal";
import { MilestoneStatusBadge } from "@/components/promise/status-badge";
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, relativeTime } from "@/lib/format";
import { orNotFound } from "@/lib/page";
import { METHOD_LABEL } from "@/lib/status";

export const metadata: Metadata = { title: "Fund milestone" };

export default async function FundPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ milestone?: string; paypal?: string; token?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/promises/${id}/fund`);
  const d = await orNotFound(() => getPromiseDetail(actorFor(user), id));
  const m =
    d.milestones.find((x) => x.id === sp.milestone) ??
    d.milestones.find((x) => x.state === "UNFUNDED" || x.state === "FUNDING") ??
    d.milestones[0];
  const back = (
    <Link href={`/promises/${id}`} className="text-sm text-ink-muted hover:text-ink">
      ← Back to promise
    </Link>
  );
  if (!m)
    return (
      <div className="space-y-4">
        {back}
        <Alert tone="warn" title="This promise has no milestones yet" />
      </div>
    );

  const amount = formatMoney(m.amountMinor, d.promise.currency);
  const f = m.funding;
  const secured = f && (f.status === "AUTHORIZED" || f.status === "REAUTHORIZED");
  const fundable = m.state === "UNFUNDED" || m.state === "FUNDING";
  const agreed = d.promise.state === "AGREED" || d.promise.state === "ACTIVE";
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {back}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fund milestone {m.position}</h1>
        <p className="mt-1 text-sm text-ink-muted">{d.promise.title}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardHeader
            title={m.title}
            description={
              <span className="inline-flex items-center gap-2">
                Status <MilestoneStatusBadge state={m.state} />
              </span>
            }
            action={<p className="tabular text-2xl font-semibold">{amount}</p>}
          />
          <CardBody className="space-y-3">
            <p className="text-sm font-medium">The worker is paid only for these, as signed:</p>
            <ul className="space-y-2">
              {m.criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-3 text-sm">
                  <span className="tabular mt-0.5 w-10 shrink-0 text-right text-ink-subtle">{c.weight}%</span>
                  <span className="min-w-0">
                    <span className="font-medium">{c.spec.title}</span>{" "}
                    <Badge tone="neutral" className="ml-1">
                      {METHOD_LABEL[c.spec.method]}
                    </Badge>
                    {c.required ? (
                      <Badge tone="warn" className="ml-1">
                        Required
                      </Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {m.dueAt ? <p className="text-sm text-ink-muted">Due {formatDateTime(m.dueAt)}</p> : null}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader title="Secure with PayPal" />
          <CardBody>
            {d.role !== "client" ? (
              <Alert tone="info" title="Only the client funds milestones">
                {d.role === "worker"
                  ? "You'll see “Funds secured” here as soon as the client approves the PayPal hold."
                  : "Switch to the client to fund."}
              </Alert>
            ) : secured ? (
              <div className="space-y-3">
                <Alert tone="brand" title={`Funds secured (${amount})`}>
                  PayPal is holding the money. Authorization{" "}
                  <span className="font-mono">{f.paypalAuthorizationId}</span>.
                </Alert>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-ink-subtle">Honor period</dt>
                  <dd>{f.honorExpiresAt ? `ends ${relativeTime(f.honorExpiresAt)}` : "—"}</dd>
                  <dt className="text-ink-subtle">Hold expires</dt>
                  <dd>{formatDateTime(f.expiresAt)}</dd>
                </dl>
                <ButtonLink href={`/promises/${id}`} variant="secondary" className="w-full">
                  Back to promise
                </ButtonLink>
              </div>
            ) : !agreed ? (
              <Alert tone="warn" title="Terms not signed yet">
                Both sides must sign the same terms version before money can be secured.
              </Alert>
            ) : !fundable ? (
              <Alert tone="info" title="Nothing to fund">
                This milestone is {m.state.toLowerCase().replace("_", " ")}.
              </Alert>
            ) : (
              <FundWithPayPal
                milestoneId={m.id}
                clientId={clientId}
                currency={d.promise.currency}
                amountLabel={amount}
                returnOrderId={sp.token}
                returnStatus={sp.paypal === "return" || sp.paypal === "cancel" ? sp.paypal : undefined}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
