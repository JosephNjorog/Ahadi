"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Criterion, TermsBody } from "@ahadi/core/criteria";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { api, ApiError, detailLines } from "@/lib/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/status";

type Issue = {
  milestoneIndex: number;
  criterionId: string | null;
  code: string;
  explanation: string;
  suggestedCriterion?: Criterion;
};

export interface TermsPanelProps {
  promiseId: string;
  state: string;
  termsStatus: "idle" | "generating" | "failed";
  termsError: string | null;
  role: "client" | "worker" | null;
  currency: string;
  budgetMinor: number | null;
  terms: {
    version: number;
    body: TermsBody;
    bodyHash: string;
    changeSummary: string | null;
    critique: { verdict: string; issues: Issue[] } | null;
    notes: { questionsForClient?: string[]; manipulationNotes?: string | null } | null;
    createdAt: string;
  } | null;
  versions: {
    version: number;
    bodyHash: string;
    source: string;
    changeSummary: string | null;
    createdAt: string;
  }[];
  signatures: { party: string; bodyHash: string; signedAt: string }[];
  worker: { displayName: string; email: string } | null;
  inviteEmail: string | null;
}

const CRITIQUE_TONE: Record<string, "warn" | "danger" | "info"> = {
  VAGUE: "warn",
  UNVERIFIABLE: "danger",
  COMPOUND: "warn",
  GAMEABLE: "danger",
  UNFAIR_TO_WORKER: "warn",
  UNFAIR_TO_CLIENT: "warn",
  WRONG_METHOD: "info",
  WEIGHT_MISMATCH: "info",
  MISSING: "danger",
};

export function TermsPanel(p: TermsPanelProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = ["DRAFT", "NEGOTIATING"].includes(p.state) && p.role !== null;

  // Poll while the Architect drafts.
  useEffect(() => {
    if (p.termsStatus !== "generating") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [p.termsStatus, router]);
  // Poll for the Critic's review shortly after a new version.
  useEffect(() => {
    if (!p.terms || p.terms.critique || p.termsStatus !== "idle") return;
    const t = setTimeout(() => router.refresh(), 5000);
    return () => clearTimeout(t);
  }, [p.terms, p.termsStatus, router]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError([(e as Error).message, ...(e instanceof ApiError ? detailLines(e.details) : [])].join(" · "));
    } finally {
      setBusy(null);
    }
  }

  const mySig = p.signatures.find((s) => s.party === p.role && s.bodyHash === p.terms?.bodyHash);
  const otherSig = p.signatures.find((s) => s.party !== p.role && s.bodyHash === p.terms?.bodyHash);

  return (
    <div className="space-y-4">
      {p.termsStatus === "generating" ? (
        <Alert tone="info" title="The Contract Architect is drafting…">
          <span className="inline-flex items-center gap-2">
            <Spinner className="size-4" /> Turning the brief into milestones and checkable criteria. This
            usually takes under a minute.
          </span>
        </Alert>
      ) : null}
      {p.termsStatus === "failed" ? (
        <Alert
          tone="danger"
          title="The contract builder couldn't finish"
          action={
            editable && p.termsError && !p.termsError.includes("ANTHROPIC_API_KEY") ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "retry"}
                onClick={() =>
                  void act("retry", () =>
                    api(`/api/promises/${p.promiseId}/terms`, {
                      body: { instruction: "Draft the contract from the brief." },
                    }),
                  )
                }
              >
                Try again
              </Button>
            ) : null
          }
        >
          {p.termsError}
          {editable ? " You can also write the criteria by hand below." : ""}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Not saved">
          {error}
        </Alert>
      ) : null}

      {p.terms?.notes?.manipulationNotes ? (
        <Alert tone="warn" title="The brief tried to instruct the AI">
          {p.terms.notes.manipulationNotes} The criteria were not affected.
        </Alert>
      ) : null}
      {p.terms?.notes?.questionsForClient?.length ? (
        <Card>
          <CardHeader
            title="Questions for the client"
            description="The Architect made reasonable defaults (see assumptions). Answer below to refine the terms."
          />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {p.terms.notes.questionsForClient.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {p.terms && !editing ? <TermsView p={p} busy={busy} act={act} editable={editable} /> : null}
      {editable && (editing || (!p.terms && p.termsStatus === "failed")) ? (
        <TermsEditor
          promiseId={p.promiseId}
          currency={p.currency}
          budgetMinor={p.budgetMinor}
          initial={p.terms?.body ?? null}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={p.terms ? () => setEditing(false) : undefined}
        />
      ) : null}

      {editable && p.terms && !editing ? (
        <Card>
          <CardHeader
            title="Change the terms"
            description="Every change creates a new version. Signatures apply to one exact version."
          />
          <CardBody className="space-y-3">
            <Field
              label="Ask the Contract Architect"
              hint='e.g. "make the mobile check stricter" or "split into design and build milestones".'
            >
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={busy === "instruct"}
                disabled={instruction.trim().length < 3 || p.termsStatus === "generating"}
                onClick={() =>
                  void act("instruct", async () => {
                    await api(`/api/promises/${p.promiseId}/terms`, { body: { instruction } });
                    setInstruction("");
                  })
                }
              >
                Ask for a revision
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing(true)}
                disabled={p.termsStatus === "generating"}
              >
                Edit by hand
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {p.role === "client" && ["DRAFT", "NEGOTIATING"].includes(p.state) ? (
          <InviteCard promiseId={p.promiseId} worker={p.worker} inviteEmail={p.inviteEmail} />
        ) : null}
        {p.terms && p.role ? (
          <Card>
            <CardHeader title="Sign" description={`Version ${p.terms.version}`} />
            <CardBody className="space-y-3 text-sm">
              <p className="break-all font-mono text-xs">{p.terms.bodyHash}</p>
              <p className="text-ink-muted">
                You sign this exact hash. If anyone changes the terms, both of you sign again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge tone={mySig ? "brand" : "neutral"}>
                  {mySig ? `You signed ${formatDateTime(mySig.signedAt)}` : "You haven't signed"}
                </Badge>
                <Badge tone={otherSig ? "brand" : "neutral"}>
                  {otherSig
                    ? `${p.role === "client" ? "Worker" : "Client"} signed`
                    : `${p.role === "client" ? "Worker" : "Client"} hasn't signed`}
                </Badge>
              </div>
              {p.state === "NEGOTIATING" && !mySig ? (
                <Button
                  className="w-full"
                  loading={busy === "sign"}
                  disabled={p.termsStatus === "generating"}
                  onClick={() =>
                    void act("sign", () =>
                      api(`/api/promises/${p.promiseId}/sign`, { body: { bodyHash: p.terms!.bodyHash } }),
                    )
                  }
                >
                  Sign version {p.terms.version}
                </Button>
              ) : null}
              {p.state === "DRAFT" ? (
                <p className="text-ink-subtle">Invite the worker to start signing.</p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}
      </div>

      {p.versions.length > 1 ? (
        <Card>
          <CardHeader title="Version history" />
          <ul className="divide-y divide-line text-sm">
            {p.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span>
                  <strong>v{v.version}</strong> · {v.changeSummary ?? v.source}
                </span>
                <span className="font-mono text-xs text-ink-subtle">
                  {v.bodyHash.slice(0, 12)}… · {formatDateTime(v.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {p.role && ["DRAFT", "NEGOTIATING", "AGREED"].includes(p.state) ? (
        <div className="text-right">
          <Button
            variant="ghost"
            size="sm"
            loading={busy === "cancel"}
            onClick={() => {
              const reason = window.prompt("Cancel this promise? Tell the other party why (optional).");
              if (reason !== null)
                void act("cancel", () => api(`/api/promises/${p.promiseId}/cancel`, { body: { reason } }));
            }}
          >
            Cancel promise
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TermsView({
  p,
  busy,
  act,
  editable,
}: {
  p: TermsPanelProps;
  busy: string | null;
  act: (l: string, f: () => Promise<unknown>) => Promise<void>;
  editable: boolean;
}) {
  const t = p.terms!;
  const issues = t.critique?.issues ?? [];
  return (
    <Card>
      <CardHeader
        title={`Proposed terms · v${t.version}`}
        description={t.changeSummary ?? undefined}
        action={
          t.critique ? (
            <Badge tone={t.critique.verdict === "ready" ? "brand" : "warn"}>
              {t.critique.verdict === "ready"
                ? "Critic: ready"
                : `Critic: ${issues.length} issue${issues.length === 1 ? "" : "s"}`}
            </Badge>
          ) : (
            <Badge tone="neutral">Critic reviewing…</Badge>
          )
        }
      />
      <CardBody className="space-y-5">
        <p className="text-sm text-ink-muted">{t.body.scopeSummary}</p>
        {t.body.milestones.map((m, mi) => (
          <div key={m.position} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                Milestone {m.position}: {m.title}
              </h3>
              <span className="tabular font-semibold">{formatMoney(m.amountMinor, p.currency)}</span>
            </div>
            {m.summary ? <p className="text-sm text-ink-muted">{m.summary}</p> : null}
            <ul className="space-y-2">
              {m.criteria.map((c) => {
                const own = issues
                  .map((iss, idx) => ({ iss, idx }))
                  .filter(({ iss }) => iss.milestoneIndex === mi && iss.criterionId === c.id);
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "rounded-lg border px-3 py-2.5",
                      own.length ? "border-warn-600/40" : "border-line",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-subtle">{c.id}</span>
                      <span className="text-sm font-medium">{c.title}</span>
                      <Badge>{METHOD_LABEL[c.method]}</Badge>
                      {c.required ? <Badge tone="warn">Required</Badge> : null}
                      {c.partialCredit ? <Badge tone="info">Partial credit</Badge> : null}
                      <span className="tabular ml-auto text-xs text-ink-muted">weight {c.weight}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{c.description}</p>
                    {c.check ? (
                      <p className="mt-1 font-mono text-xs text-ink-subtle">
                        check: {JSON.stringify(c.check)}
                      </p>
                    ) : null}
                    {own.map(({ iss, idx }) => (
                      <IssueRow
                        key={idx}
                        iss={iss}
                        idx={idx}
                        p={p}
                        busy={busy}
                        act={act}
                        editable={editable}
                      />
                    ))}
                  </li>
                );
              })}
            </ul>
            {issues
              .map((iss, idx) => ({ iss, idx }))
              .filter(({ iss }) => iss.milestoneIndex === mi && !iss.criterionId)
              .map(({ iss, idx }) => (
                <IssueRow key={idx} iss={iss} idx={idx} p={p} busy={busy} act={act} editable={editable} />
              ))}
          </div>
        ))}
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          {t.body.assumptions.length ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Assumptions</p>
              <ul className="mt-1 list-disc pl-5 text-ink-muted">
                {t.body.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {t.body.outOfScope.length ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Out of scope</p>
              <ul className="mt-1 list-disc pl-5 text-ink-muted">
                {t.body.outOfScope.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function IssueRow({
  iss,
  idx,
  p,
  busy,
  act,
  editable,
}: {
  iss: Issue;
  idx: number;
  p: TermsPanelProps;
  busy: string | null;
  act: (l: string, f: () => Promise<unknown>) => Promise<void>;
  editable: boolean;
}) {
  return (
    <div className="mt-2 rounded-md bg-warn-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CRITIQUE_TONE[iss.code] ?? "warn"}>{iss.code.replace(/_/g, " ").toLowerCase()}</Badge>
        <span className="text-ink-muted">{iss.explanation}</span>
      </div>
      {iss.suggestedCriterion ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-ink-muted">
            Suggestion: <strong>{iss.suggestedCriterion.title}</strong> — {iss.suggestedCriterion.description}
          </span>
          {editable ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy === `apply-${idx}`}
              onClick={() =>
                void act(`apply-${idx}`, () =>
                  api(`/api/promises/${p.promiseId}/terms/apply`, { body: { issueIndex: idx } }),
                )
              }
            >
              Apply suggestion
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InviteCard({
  promiseId,
  worker,
  inviteEmail,
}: {
  promiseId: string;
  worker: { displayName: string; email: string } | null;
  inviteEmail: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(inviteEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "brand" | "danger"; text: string } | null>(null);
  return (
    <Card>
      <CardHeader
        title="Worker"
        description={
          worker
            ? `${worker.displayName} (${worker.email})`
            : "Invite the person (or agent's owner) doing the work"
        }
      />
      <CardBody>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMsg(null);
            try {
              await api(`/api/promises/${promiseId}/invite`, { body: { email } });
              setMsg({ tone: "brand", text: "Invitation sent." });
              router.refresh();
            } catch (err) {
              setMsg({ tone: "danger", text: (err as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="worker@example.com"
            aria-label="Worker email"
          />
          <Button type="submit" loading={busy}>
            {worker ? "Change" : "Invite"}
          </Button>
        </form>
        {msg ? (
          <p className={cn("mt-2 text-sm", msg.tone === "danger" ? "text-danger-600" : "text-brand-700")}>
            {msg.text}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

const EMPTY_CRITERION = (id: string): Criterion => ({
  id,
  title: "",
  description: "",
  weight: 0,
  required: false,
  method: "ai_judgment",
  evidence: ["text_content"],
  partialCredit: false,
});

function TermsEditor({
  promiseId,
  currency,
  budgetMinor,
  initial,
  onDone,
  onCancel,
}: {
  promiseId: string;
  currency: string;
  budgetMinor: number | null;
  initial: TermsBody | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState<TermsBody>(
    initial ?? {
      title: "Untitled",
      category: "web",
      currency,
      scopeSummary: "",
      outOfScope: [],
      assumptions: [],
      milestones: [
        {
          position: 1,
          title: "Milestone 1",
          summary: "",
          amountMinor: budgetMinor ?? 10000,
          deliverables: ["Deliverable"],
          criteria: [EMPTY_CRITERION("c1"), EMPTY_CRITERION("c2"), EMPTY_CRITERION("c3")],
        },
      ],
    },
  );
  const [checkText, setCheckText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      body.milestones.flatMap((m) =>
        m.criteria.map((c) => [`${m.position}:${c.id}`, c.check ? JSON.stringify(c.check) : ""]),
      ),
    ),
  );
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const problems = useMemo(() => {
    const out: string[] = [];
    const total = body.milestones.reduce((s, m) => s + m.amountMinor, 0);
    if (budgetMinor != null && total !== budgetMinor)
      out.push(
        `Milestones add up to ${formatMoney(total, currency)}; the budget is ${formatMoney(budgetMinor, currency)}.`,
      );
    body.milestones.forEach((m) => {
      const w = m.criteria.reduce((s, c) => s + c.weight, 0);
      if (w !== 100) out.push(`Milestone ${m.position}: weights add up to ${w}, not 100.`);
      if (m.criteria.some((c) => !c.title.trim() || !c.description.trim()))
        out.push(`Milestone ${m.position}: every criterion needs a title and description.`);
    });
    return out;
  }, [body, budgetMinor, currency]);

  const setMilestone = (i: number, patch: Partial<TermsBody["milestones"][number]>) =>
    setBody({ ...body, milestones: body.milestones.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const setCriterion = (mi: number, ci: number, patch: Partial<Criterion>) =>
    setMilestone(mi, {
      criteria: body.milestones[mi]!.criteria.map((c, k) => (k === ci ? { ...c, ...patch } : c)),
    });

  async function save() {
    setErrors([]);
    const out = structuredClone(body);
    for (const m of out.milestones) {
      for (const c of m.criteria) {
        const raw = checkText[`${m.position}:${c.id}`]?.trim();
        if (c.method === "automated") {
          try {
            c.check = JSON.parse(raw || "null");
          } catch {
            setErrors([`${c.id}: the machine check must be JSON, e.g. {"kind":"http_ok"}`]);
            return;
          }
        } else delete c.check;
      }
    }
    setBusy(true);
    try {
      await api(`/api/promises/${promiseId}/terms`, {
        body: { body: out, changeSummary: summary || undefined },
      });
      onDone();
    } catch (e) {
      setErrors([(e as Error).message, ...(e instanceof ApiError ? detailLines(e.details) : [])]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Edit terms"
        description="Weights must add up to 100 per milestone; milestone amounts must add up to the budget."
      />
      <CardBody className="space-y-5">
        <Field label="Scope summary">
          <Textarea
            rows={2}
            value={body.scopeSummary}
            onChange={(e) => setBody({ ...body, scopeSummary: e.target.value })}
            maxLength={600}
          />
        </Field>
        {body.milestones.map((m, mi) => (
          <fieldset key={mi} className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Milestone {m.position}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Title" className="sm:col-span-2">
                <Input
                  value={m.title}
                  onChange={(e) => setMilestone(mi, { title: e.target.value })}
                  maxLength={80}
                />
              </Field>
              <Field label={`Amount (${currency})`}>
                <Input
                  inputMode="decimal"
                  value={String(m.amountMinor / 100)}
                  onChange={(e) =>
                    setMilestone(mi, { amountMinor: Math.round(Number(e.target.value || 0) * 100) })
                  }
                />
              </Field>
            </div>
            {m.criteria.map((c, ci) => (
              <div key={ci} className="space-y-2 rounded-md bg-canvas p-3">
                <div className="grid gap-2 sm:grid-cols-6">
                  <Input
                    aria-label="Criterion title"
                    className="sm:col-span-3"
                    placeholder={`${c.id} title`}
                    value={c.title}
                    onChange={(e) => setCriterion(mi, ci, { title: e.target.value })}
                    maxLength={80}
                  />
                  <Select
                    aria-label="Method"
                    className="sm:col-span-1"
                    value={c.method}
                    onChange={(e) => setCriterion(mi, ci, { method: e.target.value as Criterion["method"] })}
                  >
                    <option value="automated">Automated</option>
                    <option value="ai_judgment">AI</option>
                    <option value="human">Human</option>
                  </Select>
                  <Input
                    aria-label="Weight"
                    className="sm:col-span-1"
                    inputMode="numeric"
                    value={String(c.weight)}
                    onChange={(e) =>
                      setCriterion(mi, ci, {
                        weight: Math.max(0, Math.min(100, Number(e.target.value || 0))),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="sm:col-span-1"
                    disabled={m.criteria.length <= 1}
                    onClick={() => setMilestone(mi, { criteria: m.criteria.filter((_, k) => k !== ci) })}
                  >
                    Remove
                  </Button>
                </div>
                <Textarea
                  aria-label="Description"
                  rows={2}
                  placeholder="Precise, testable wording"
                  value={c.description}
                  onChange={(e) => setCriterion(mi, ci, { description: e.target.value })}
                  maxLength={400}
                />
                {c.method === "automated" ? (
                  <Input
                    aria-label="Machine check JSON"
                    className="font-mono text-sm"
                    placeholder='{"kind":"no_horizontal_scroll","viewportWidth":375}'
                    value={checkText[`${m.position}:${c.id}`] ?? ""}
                    onChange={(e) =>
                      setCheckText({ ...checkText, [`${m.position}:${c.id}`]: e.target.value })
                    }
                  />
                ) : null}
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.required}
                      onChange={(e) => setCriterion(mi, ci, { required: e.target.checked })}
                    />{" "}
                    Required
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.partialCredit}
                      onChange={(e) => setCriterion(mi, ci, { partialCredit: e.target.checked })}
                    />{" "}
                    Partial credit allowed
                  </label>
                </div>
              </div>
            ))}
            {m.criteria.length < 8 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setMilestone(mi, {
                    criteria: [
                      ...m.criteria,
                      EMPTY_CRITERION(`c${Math.max(0, ...m.criteria.map((c) => Number(c.id.slice(1)))) + 1}`),
                    ],
                  })
                }
              >
                Add criterion
              </Button>
            ) : null}
          </fieldset>
        ))}
        <Field label="What changed (optional)">
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} />
        </Field>
        {problems.length ? (
          <Alert tone="warn" title="Fix before saving">
            {problems.join(" ")}
          </Alert>
        ) : null}
        {errors.length ? (
          <Alert tone="danger" title="Not saved">
            {errors.join(" · ")}
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button onClick={() => void save()} loading={busy} disabled={problems.length > 0}>
            Save as new version
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
