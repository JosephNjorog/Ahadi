"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { bpsToPercent } from "@ahadi/core/money";
import { estimateMpesaKes } from "@ahadi/core/settlement";
import type { MilestoneState } from "@ahadi/core/state";
import type { VerificationView } from "@ahadi/services";
import { MilestoneStatusBadge } from "@/components/promise/status-badge";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { api } from "@/lib/client";
import { formatDateTime, formatMoney, relativeTime } from "@/lib/format";
import { METHOD_LABEL, MILESTONE_STATUS } from "@/lib/status";

type View = VerificationView;
const STAGES = [
  ["collecting", "Collecting evidence"],
  ["scanning", "Scanning for manipulation"],
  ["checking", "Machine checks"],
  ["judging", "Verifier agents"],
  ["reviewing", "Second opinion"],
  ["settling", "Computing release"],
] as const;
const OUTCOME_TONE = { pass: "brand", partial: "warn", fail: "danger", undetermined: "neutral" } as const;

export function LiveVerification({ initial, kesPerUsd }: { initial: View; kesPerUsd: number }) {
  const router = useRouter();
  const [v, setV] = useState<View>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/milestones/${initial.milestone.id}/verification/stream`);
    es.addEventListener("snapshot", (e) => {
      setV(JSON.parse((e as MessageEvent).data));
      setLive(true);
    });
    es.addEventListener("error", () => setLive(false));
    return () => es.close();
  }, [initial.milestone.id]);

  const running = ["SUBMITTED", "VERIFYING"].includes(v.milestone.state);
  const stageIdx = STAGES.findIndex(([s]) => s === v.verification?.stage);
  const status = MILESTONE_STATUS[v.milestone.state as MilestoneState];
  const report = v.verification?.injectionReport as {
    findings?: { id: string; location: string; text: string; severity: string }[];
    sentinel?: {
      summaryForClient?: string;
      findings?: { findingId: string; classification: string; quoteForClient: string }[];
    } | null;
  } | null;
  const screenshots = v.evidence.filter((e) => e.kind === "screenshot");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Verification · milestone {v.milestone.position}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {v.milestone.title} · attempt {v.submission?.attempt}{" "}
            <MilestoneStatusBadge state={v.milestone.state} />
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                live ? "text-brand-700" : "text-ink-subtle",
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-brand-500" : "bg-line")}
              />{" "}
              {live ? "live" : "connecting"}
            </span>
          </p>
        </div>
        {v.submission ? (
          <p className="max-w-full truncate text-sm text-ink-muted">
            Deliverable:{" "}
            {v.submission.url ? (
              <a
                href={v.submission.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
              >
                {v.submission.url}
              </a>
            ) : v.submission.repoUrl ? (
              <span className="font-mono">
                {v.submission.repoUrl} @ {v.submission.commitSha?.slice(0, 10)}
              </span>
            ) : (
              v.submission.kind
            )}
          </p>
        ) : null}
      </div>

      {v.verification?.injectionFlagged ? (
        <Alert tone="danger" title="Hidden instructions found — release blocked">
          {report?.sentinel?.summaryForClient ??
            "The deliverable contains text aimed at the AI verifier (for example, telling it to approve payment). It was removed before verification and the result needs a human reviewer."}
          {report?.sentinel?.findings
            ?.filter((f) => f.classification === "injection")
            .slice(0, 3)
            .map((f) => (
              <span
                key={f.findingId}
                className="mt-1 block rounded bg-surface px-2 py-1 font-mono text-xs text-danger-600"
              >
                “{f.quoteForClient}”
              </span>
            )) ??
            report?.findings
              ?.filter((f) => f.severity === "high")
              .slice(0, 3)
              .map((f) => (
                <span
                  key={f.id}
                  className="mt-1 block rounded bg-surface px-2 py-1 font-mono text-xs text-danger-600"
                >
                  “{f.text.slice(0, 160)}”
                </span>
              ))}
        </Alert>
      ) : null}

      {running || v.verification?.stage !== "done" ? (
        <Card>
          <CardBody>
            <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {STAGES.map(([key, label], i) => (
                <li
                  key={key}
                  className={cn(
                    "flex items-center gap-2",
                    i < stageIdx
                      ? "text-brand-700"
                      : i === stageIdx
                        ? "font-medium text-ink"
                        : "text-ink-subtle",
                  )}
                >
                  {i < stageIdx ? "✓" : i === stageIdx ? <Spinner className="size-3.5" /> : "○"} {label}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}
      {v.warnings.length ? (
        <Alert tone="warn" title="Collection notes">
          {v.warnings.join(" ")}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Criteria" description={v.verification?.summary ?? status?.client} />
          <ul className="divide-y divide-line">
            {v.criteria.map((c) => {
              const r = c.result;
              return (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-6 items-center justify-center">
                      {r ? (
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full text-xs text-white",
                            r.outcome === "pass"
                              ? "bg-brand-500"
                              : r.outcome === "fail"
                                ? "bg-danger-600"
                                : r.outcome === "partial"
                                  ? "bg-warn-600"
                                  : "bg-ink-subtle",
                          )}
                        >
                          {r.outcome === "pass"
                            ? "✓"
                            : r.outcome === "fail"
                              ? "✕"
                              : r.outcome === "partial"
                                ? "½"
                                : "?"}
                        </span>
                      ) : running ? (
                        <Spinner className="size-4 text-ink-subtle" />
                      ) : (
                        "○"
                      )}
                    </span>
                    <span className="font-medium">{c.spec.title}</span>
                    <Badge>{METHOD_LABEL[c.spec.method]}</Badge>
                    {c.required ? <Badge tone="warn">Required</Badge> : null}
                    <span className="tabular ml-auto text-xs text-ink-muted">weight {c.weight}</span>
                  </div>
                  {r ? (
                    <div className="ml-8 mt-1 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={OUTCOME_TONE[r.outcome]}>
                          {r.outcome}
                          {r.outcome === "partial" ? ` ${Math.round(r.credit * 100)}%` : ""}
                        </Badge>
                        <span className="text-xs text-ink-subtle">
                          {r.decidedBy === "machine"
                            ? "machine check"
                            : r.decidedBy === "agent"
                              ? "verifier agent"
                              : "human"}{" "}
                          · confidence {Math.round(r.confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-ink-muted">{r.reasoning}</p>
                      {r.howToFix ? (
                        <p className="text-ink-muted">
                          <strong>To fix:</strong> {r.howToFix}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <VerdictPanel v={v} kesPerUsd={kesPerUsd} onChange={() => router.refresh()} />
          {screenshots.length ? (
            <Card>
              <CardHeader title="Evidence" description="Collected by Ahadi, hashed into the ledger" />
              <CardBody className="grid grid-cols-2 gap-3">
                {screenshots.map((s) => (
                  <a
                    key={s.id}
                    href={`/api/artifacts/${s.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/artifacts/${s.id}`}
                      alt={String((s.meta as { label?: string })?.label ?? "Screenshot")}
                      className="h-40 w-full rounded-lg border border-line object-cover object-top group-hover:opacity-90"
                      loading="lazy"
                    />
                    <span className="mt-1 block truncate text-xs text-ink-muted">
                      {String((s.meta as { label?: string })?.label ?? "Screenshot")}
                    </span>
                  </a>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      {v.milestone.state === "NEEDS_HUMAN" && (v.isAdmin || v.role === "client") ? (
        <HumanReview v={v} />
      ) : null}
    </div>
  );
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span>window closed — finalising</span>;
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <span className="tabular">{h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`} left</span>
  );
}

function VerdictPanel({ v, kesPerUsd, onChange }: { v: View; kesPerUsd: number; onChange: () => void }) {
  const p = v.proposal;
  const [mode, setMode] = useState<null | "object">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cur = v.promise.currency;
  const expl = (v.role === "worker" ? p?.explanationWorker : p?.explanationClient) as
    { headline: string; body: string; nextSteps: string } | null | undefined;
  const myDecision = v.role === "client" ? p?.clientDecision : v.role === "worker" ? p?.workerDecision : null;
  const open = v.milestone.state === "OBJECTION_WINDOW" && p;
  const workerGets = p ? p.captureMinor - p.platformFeeMinor : 0;

  async function decide(decision: "accept" | "object" | "resubmit") {
    setBusy(decision);
    setError(null);
    try {
      await api(`/api/milestones/${v.milestone.id}/decision`, {
        body: { decision, reason: decision === "object" ? reason : undefined },
      });
      setMode(null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!p) {
    return (
      <Card>
        <CardHeader title="Verdict" />
        <CardBody className="text-sm text-ink-muted">
          {MILESTONE_STATUS[v.milestone.state as MilestoneState]?.[
            v.role === "worker" ? "worker" : "client"
          ] ?? "Waiting for verification."}
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Proposed release"
        description={
          open ? <Countdown to={String(p.windowEndsAt)} /> : `Published ${formatDateTime(p.createdAt)}`
        }
      />
      <CardBody className="space-y-4">
        <div className="flex items-end gap-3">
          <p className="tabular text-4xl font-semibold">{bpsToPercent(p.releaseBps)}</p>
          <p className="pb-1 text-sm text-ink-muted">of {formatMoney(v.milestone.amountMinor, cur)}</p>
        </div>
        <dl className="tabular grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-ink-muted">Captured from the hold</dt>
          <dd className="font-medium">{formatMoney(p.captureMinor, cur)}</dd>
          <dt className="text-ink-muted">Released back to the client</dt>
          <dd>{formatMoney(v.milestone.amountMinor - p.captureMinor, cur)}</dd>
          <dt className="text-ink-muted">Ahadi fee</dt>
          <dd>{formatMoney(p.platformFeeMinor, cur)}</dd>
          <dt className="text-ink-muted">Worker receives (before PayPal fee)</dt>
          <dd className="font-medium">{formatMoney(workerGets, cur)}</dd>
          {cur === "USD" && workerGets > 0 ? (
            <>
              <dt className="text-ink-muted">≈ lands in M-Pesa (estimate)</dt>
              <dd>KES {estimateMpesaKes(workerGets, kesPerUsd).toLocaleString("en-KE")}</dd>
            </>
          ) : null}
        </dl>
        {expl ? (
          <div className="rounded-lg bg-canvas p-3 text-sm">
            <p className="font-medium">{expl.headline}</p>
            <p className="mt-1 text-ink-muted">{expl.body}</p>
            <p className="mt-1 text-ink-muted">{expl.nextSteps}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{p.explanation}</p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge
            tone={
              p.clientDecision === "accept" ? "brand" : p.clientDecision === "object" ? "danger" : "neutral"
            }
          >
            Client: {p.clientDecision ?? "pending"}
          </Badge>
          <Badge
            tone={
              p.workerDecision === "accept" ? "brand" : p.workerDecision === "object" ? "danger" : "neutral"
            }
          >
            Worker: {p.workerDecision ?? "pending"}
          </Badge>
          {p.requiresHumanConfirm ? <Badge tone="warn">Needs explicit client confirmation</Badge> : null}
        </div>
        {open && v.role && !myDecision ? (
          mode === "object" ? (
            <div className="space-y-2">
              <Field
                label="What do you disagree with?"
                hint="Be specific: which criterion, and what the evidence shows. A mediator reviews both sides."
              >
                <Textarea
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={4000}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={busy === "object"}
                  disabled={reason.trim().length < 10}
                  onClick={() => void decide("object")}
                >
                  Object and open mediation
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === "accept"} onClick={() => void decide("accept")}>
                {v.role === "client" ? `Accept — release ${formatMoney(p.captureMinor, cur)}` : "Accept"}
              </Button>
              {v.role === "worker" && v.milestone.attemptsUsed < v.milestone.maxAttempts ? (
                <Button
                  variant="secondary"
                  loading={busy === "resubmit"}
                  onClick={() => void decide("resubmit")}
                >
                  Fix and resubmit
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setMode("object")}>
                Object
              </Button>
            </div>
          )
        ) : null}
        {open && myDecision ? (
          <p className="text-sm text-ink-muted">
            You chose “{myDecision}”.{" "}
            {p.windowEndsAt
              ? `If the other side doesn't respond, the proposal applies ${relativeTime(p.windowEndsAt)}.`
              : ""}
          </p>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Not recorded">
            {error}
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}

function HumanReview({ v }: { v: View }) {
  const router = useRouter();
  const decidable = useMemo(
    () =>
      v.criteria.filter((c) =>
        v.isAdmin
          ? !c.result ||
            c.result.outcome === "undetermined" ||
            c.result.confidence < 0.8 ||
            v.verification?.injectionFlagged
          : c.spec.method === "human",
      ),
    [v],
  );
  const [d, setD] = useState<
    Record<string, { outcome: "pass" | "partial" | "fail"; credit: number; reasoning: string }>
  >(
    Object.fromEntries(
      decidable.map((c) => [
        c.key,
        {
          outcome: c.result?.outcome === "fail" ? "fail" : "pass",
          credit: 0.5,
          reasoning: c.result?.reasoning && c.result.outcome !== "undetermined" ? c.result.reasoning : "",
        },
      ]),
    ),
  );
  const [clear, setClear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!decidable.length)
    return v.isAdmin ? null : (
      <Alert tone="info" title="Waiting for an Ahadi reviewer">
        The blocked criteria need an Ahadi reviewer; you'll be notified.
      </Alert>
    );

  return (
    <Card>
      <CardHeader
        title={v.isAdmin ? "Reviewer decision" : "Your decision"}
        description={
          v.isAdmin
            ? "Decide the blocked criteria from the evidence. Every decision is written to the ledger."
            : "These criteria are yours to judge (taste-based)."
        }
      />
      <CardBody className="space-y-4">
        {decidable.map((c) => {
          const s = d[c.key]!;
          return (
            <fieldset key={c.key} className="rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium">
                {c.key} · {c.spec.title}
              </legend>
              <p className="text-sm text-ink-muted">{c.spec.description}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["pass", ...(c.spec.partialCredit ? ["partial"] : []), "fail"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={s.outcome === o}
                    onClick={() => setD({ ...d, [c.key]: { ...s, outcome: o as "pass" } })}
                    className={cn(
                      "h-8 rounded-lg border px-3 text-sm capitalize",
                      s.outcome === o ? "border-ink bg-raised text-ink" : "border-line text-ink-muted",
                    )}
                  >
                    {o}
                  </button>
                ))}
                {s.outcome === "partial" ? (
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={5}
                    value={Math.round(s.credit * 100)}
                    onChange={(e) => setD({ ...d, [c.key]: { ...s, credit: Number(e.target.value) / 100 } })}
                    aria-label="Partial credit"
                  />
                ) : null}
              </div>
              <Textarea
                className="mt-2"
                rows={2}
                placeholder="Reasoning (shown to both parties)"
                value={s.reasoning}
                onChange={(e) => setD({ ...d, [c.key]: { ...s, reasoning: e.target.value } })}
              />
            </fieldset>
          );
        })}
        {v.isAdmin && v.verification?.injectionFlagged ? (
          <Field
            label="Clear the injection flag (admin)"
            hint="Only if the flagged text is harmless or was stripped and the real evidence supports the verdicts. Leave empty to keep it blocked."
          >
            <Textarea rows={2} value={clear} onChange={(e) => setClear(e.target.value)} />
          </Field>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Not recorded">
            {error}
          </Alert>
        ) : null}
        <Button
          loading={busy}
          onClick={async () => {
            if (Object.values(d).some((x) => x.reasoning.trim().length < 3))
              return setError("Add a short reasoning for each criterion.");
            setBusy(true);
            setError(null);
            try {
              await api(`/api/milestones/${v.milestone.id}/review`, {
                body: {
                  decisions: Object.entries(d).map(([criterionKey, x]) => ({
                    criterionKey,
                    outcome: x.outcome,
                    credit: x.outcome === "partial" ? x.credit : undefined,
                    reasoning: x.reasoning,
                  })),
                  clearInjection: clear.trim().length >= 5 ? { note: clear } : undefined,
                },
              });
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Record decision
        </Button>
      </CardBody>
    </Card>
  );
}
