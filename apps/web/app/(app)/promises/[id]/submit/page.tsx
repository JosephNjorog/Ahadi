import type { Metadata } from "next";
import Link from "next/link";
import { getPromiseDetail } from "@ahadi/services";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { orNotFound } from "@/lib/page";
import { METHOD_LABEL } from "@/lib/status";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Submit work" };

export default async function SubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ milestone?: string }>;
}) {
  const { id } = await params;
  const { milestone } = await searchParams;
  const user = await requireUser(`/promises/${id}/submit`);
  const d = await orNotFound(() => getPromiseDetail(actorFor(user), id));
  const m = d.milestones.find((x) => x.id === milestone) ?? d.milestones.find((x) => x.state === "FUNDED");
  const back = (
    <Link href={`/promises/${id}`} className="text-sm text-ink-muted hover:text-ink">
      ← {d.promise.title}
    </Link>
  );
  if (!m)
    return (
      <div className="space-y-4">
        {back}
        <Alert tone="info" title="Nothing to submit">
          No funded milestone is waiting for work.
        </Alert>
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {back}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Submit milestone {m.position}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {m.title} · {formatMoney(m.amountMinor, d.promise.currency)} · attempt {m.attemptsUsed + 1} of{" "}
          {m.maxAttempts}
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardHeader title="Your deliverable" />
          <CardBody>
            {d.role !== "worker" ? (
              <Alert tone="info" title="Only the worker submits work" />
            ) : m.state !== "FUNDED" ? (
              <Alert tone="info" title="Not open for submission">
                This milestone is {m.state.toLowerCase().replace("_", " ")}.
              </Alert>
            ) : (
              <SubmitForm milestoneId={m.id} promiseId={id} category={d.promise.category} />
            )}
          </CardBody>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader
            title="You'll be paid for these"
            description="As signed. Verifiers check exactly these, nothing more."
          />
          <CardBody>
            <ul className="space-y-3 text-sm">
              {m.criteria.map((c) => (
                <li key={c.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular w-9 text-right text-ink-subtle">{c.weight}%</span>
                    <span className="font-medium">{c.spec.title}</span>
                    <Badge>{METHOD_LABEL[c.spec.method]}</Badge>
                    {c.required ? <Badge tone="warn">Required</Badge> : null}
                  </div>
                  <p className="ml-11 mt-0.5 text-ink-muted">{c.spec.description}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
