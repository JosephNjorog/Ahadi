"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { bpsToPercent } from "@ahadi/core/money";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client";
import { formatDateTime, formatMoney } from "@/lib/format";

type Mediation = {
  id: string;
  openedBy: string;
  status: string;
  outcome: string | null;
  clientStatement: string | null;
  workerStatement: string | null;
  clientDecision: string | null;
  workerDecision: string | null;
  rejections: number;
  createdAt: string;
  aiResolution: null | {
    pendingAdmin?: boolean;
    clientPosition?: string;
    workerPosition?: string;
    resolution?: "uphold" | "adjust" | "resubmit" | "escalate";
    disagreements?: { criterionId: string | null; category: string; finding: string }[];
    adjustments?: { criterionId: string; newOutcome: string; newCredit: number; reason: string }[];
    resubmitFixList?: string[];
    messageToParties?: string;
    recomputed?: { releaseBps: number; captureMinor: number } | null;
    proposedBy?: string;
  };
};
type View = {
  role: "client" | "worker" | null;
  isAdmin: boolean;
  mediations: Mediation[];
  proposals: { id: string; releaseBps: number; captureMinor: number }[];
  milestone: { id: string; state: string };
};

export function MediationClient({ view, currency }: { view: View; currency: string }) {
  const router = useRouter();
  const m = view.mediations[0]!;
  const r = m.aiResolution;
  const original = view.proposals[0];
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const myStatement =
    view.role === "client" ? m.clientStatement : view.role === "worker" ? m.workerStatement : null;
  const myDecision =
    view.role === "client" ? m.clientDecision : view.role === "worker" ? m.workerDecision : null;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone={m.status === "CLOSED" ? "neutral" : "warn"}>{m.status.toLowerCase()}</Badge>
        {m.outcome ? <Badge tone={m.outcome === "escalated" ? "danger" : "brand"}>{m.outcome}</Badge> : null}
        <span className="text-ink-muted">
          Opened by the {m.openedBy} · {formatDateTime(m.createdAt)} · rejections {m.rejections}/2
        </span>
      </div>
      {original ? (
        <p className="text-sm text-ink-muted">
          Original proposal: <strong>{bpsToPercent(original.releaseBps)}</strong> ={" "}
          {formatMoney(original.captureMinor, currency)}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(["client", "worker"] as const).map((party) => {
          const s = party === "client" ? m.clientStatement : m.workerStatement;
          return (
            <Card key={party}>
              <CardHeader title={`${party === "client" ? "Client" : "Worker"}'s statement`} />
              <CardBody>
                {s ? (
                  <p className="whitespace-pre-wrap text-sm">{s}</p>
                ) : (
                  <p className="text-sm text-ink-subtle">Not submitted yet.</p>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {view.role && m.status === "OPEN" ? (
        <Card>
          <CardHeader
            title={myStatement ? "Update your statement" : "Add your side"}
            description="Statements are claims; the mediator weighs them against the signed terms and the evidence. Be specific."
          />
          <CardBody className="space-y-3">
            <Textarea
              rows={5}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={4000}
              placeholder={myStatement ?? ""}
            />
            <Button
              loading={busy === "statement"}
              disabled={statement.trim().length < 10}
              onClick={() =>
                void run("statement", () => api(`/api/mediations/${m.id}/statement`, { body: { statement } }))
              }
            >
              Submit statement
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {r && !r.pendingAdmin ? (
        <Card>
          <CardHeader
            title="Mediator's proposal"
            description={
              r.proposedBy?.startsWith("admin")
                ? "Proposed by an Ahadi admin"
                : "Proposed by the Ahadi Mediator"
            }
            action={<Badge tone="info">{r.resolution}</Badge>}
          />
          <CardBody className="space-y-4 text-sm">
            {r.messageToParties ? <p className="whitespace-pre-wrap">{r.messageToParties}</p> : null}
            <div className="grid gap-3 md:grid-cols-2">
              {r.clientPosition ? (
                <p className="text-ink-muted">
                  <strong className="text-ink">Client:</strong> {r.clientPosition}
                </p>
              ) : null}
              {r.workerPosition ? (
                <p className="text-ink-muted">
                  <strong className="text-ink">Worker:</strong> {r.workerPosition}
                </p>
              ) : null}
            </div>
            {r.disagreements?.length ? (
              <ul className="space-y-1">
                {r.disagreements.map((x, i) => (
                  <li key={i}>
                    <Badge>{x.category.replace(/_/g, " ").toLowerCase()}</Badge>{" "}
                    {x.criterionId ? <span className="font-mono text-xs">{x.criterionId}</span> : null}{" "}
                    {x.finding}
                  </li>
                ))}
              </ul>
            ) : null}
            {r.resolution === "adjust" && r.recomputed ? (
              <Alert
                tone="info"
                title={`Adjusted release: ${bpsToPercent(r.recomputed.releaseBps)} = ${formatMoney(r.recomputed.captureMinor, currency)}`}
              >
                {r.adjustments
                  ?.map(
                    (a) =>
                      `${a.criterionId} → ${a.newOutcome}${a.newOutcome === "partial" ? ` ${Math.round(a.newCredit * 100)}%` : ""} (${a.reason})`,
                  )
                  .join("; ")}
              </Alert>
            ) : null}
            {r.resolution === "resubmit" && r.resubmitFixList?.length ? (
              <div>
                <p className="font-medium">Fix list for the resubmission</p>
                <ul className="mt-1 list-disc pl-5 text-ink-muted">
                  {r.resubmitFixList.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge
                tone={
                  m.clientDecision === "accept"
                    ? "brand"
                    : m.clientDecision === "reject"
                      ? "danger"
                      : "neutral"
                }
              >
                Client: {m.clientDecision ?? "pending"}
              </Badge>
              <Badge
                tone={
                  m.workerDecision === "accept"
                    ? "brand"
                    : m.workerDecision === "reject"
                      ? "danger"
                      : "neutral"
                }
              >
                Worker: {m.workerDecision ?? "pending"}
              </Badge>
            </div>
            {view.role && m.status === "PROPOSED" && !myDecision ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  loading={busy === "accept"}
                  onClick={() =>
                    void run("accept", () =>
                      api(`/api/mediations/${m.id}/decision`, { body: { decision: "accept" } }),
                    )
                  }
                >
                  Accept resolution
                </Button>
                <Button
                  variant="secondary"
                  loading={busy === "reject"}
                  onClick={() =>
                    window.confirm(
                      m.rejections >= 1
                        ? "A second rejection escalates this to PayPal's dispute process. Continue?"
                        : "Reject and start one more mediation round?",
                    ) &&
                    void run("reject", () =>
                      api(`/api/mediations/${m.id}/decision`, { body: { decision: "reject" } }),
                    )
                  }
                >
                  Reject
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : m.status !== "CLOSED" ? (
        <Alert
          tone="info"
          title={
            r?.pendingAdmin
              ? "Waiting for an Ahadi admin"
              : "The mediator runs when both statements are in, or 24 hours after opening"
          }
        />
      ) : null}

      {view.isAdmin && ["OPEN", "PROPOSED"].includes(m.status) ? (
        <AdminResolution mediationId={m.id} onDone={() => router.refresh()} />
      ) : null}
      {error ? (
        <Alert tone="danger" title="Not recorded">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}

function AdminResolution({ mediationId, onDone }: { mediationId: string; onDone: () => void }) {
  const [resolution, setResolution] = useState<"uphold" | "adjust" | "resubmit" | "escalate">("uphold");
  const [message, setMessage] = useState("");
  const [adjust, setAdjust] = useState("c4:pass:1:Evidence shows it fits at 375px");
  const [fixes, setFixes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Admin: propose a resolution"
        description="Use when AI mediation is off or its proposal needs correcting."
      />
      <CardBody className="space-y-3">
        <Field label="Resolution">
          <Select value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
            <option value="uphold">Uphold the proposal</option>
            <option value="adjust">Adjust criteria</option>
            <option value="resubmit">Worker resubmits</option>
            <option value="escalate">Escalate</option>
          </Select>
        </Field>
        {resolution === "adjust" ? (
          <Field
            label="Adjustments"
            hint="One per line: criterionId:outcome:credit:reason — outcome is pass, partial or fail"
          >
            <Textarea
              rows={3}
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
              className="font-mono text-sm"
            />
          </Field>
        ) : null}
        {resolution === "resubmit" ? (
          <Field label="Fix list" hint="One item per line">
            <Textarea rows={3} value={fixes} onChange={(e) => setFixes(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Message to both parties">
          <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1200} />
        </Field>
        {error ? (
          <Alert tone="danger" title="Not saved">
            {error}
          </Alert>
        ) : null}
        <Button
          loading={busy}
          disabled={message.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const adjustments =
                resolution === "adjust"
                  ? adjust
                      .split("\n")
                      .filter(Boolean)
                      .map((l) => {
                        const [criterionId, newOutcome, credit, ...reason] = l.split(":");
                        return {
                          criterionId: criterionId!.trim(),
                          newOutcome: newOutcome!.trim(),
                          newCredit: Number(credit),
                          reason: reason.join(":").trim() || "Admin decision",
                        };
                      })
                  : [];
              await api(`/api/mediations/${mediationId}/resolution`, {
                body: {
                  clientPosition: "See statement.",
                  workerPosition: "See statement.",
                  disagreements: [],
                  resolution,
                  adjustments,
                  resubmitFixList: resolution === "resubmit" ? fixes.split("\n").filter(Boolean) : undefined,
                  escalationReason: resolution === "escalate" ? message : undefined,
                  messageToParties: message,
                },
              });
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Propose resolution
        </Button>
      </CardBody>
    </Card>
  );
}
