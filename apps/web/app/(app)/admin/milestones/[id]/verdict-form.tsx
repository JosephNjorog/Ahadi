"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { bpsToPercent } from "@ahadi/core/money";
import { computeProposal, type SettlementPolicy } from "@ahadi/core/settlement";
import { Alert, Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/format";

type C = { key: string; title: string; description: string; weight: number; required: boolean; partialCredit: boolean };
type Outcome = "pass" | "partial" | "fail";

export function VerdictForm({ milestoneId, promiseId, amountMinor, currency, policy, criteria }: { milestoneId: string; promiseId: string; amountMinor: number; currency: string; policy: SettlementPolicy; criteria: C[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, { outcome: Outcome; credit: number; reasoning: string }>>(
    Object.fromEntries(criteria.map((c) => [c.key, { outcome: "pass" as Outcome, credit: 0.5, reasoning: "" }])),
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  // The same pure engine the server runs — the preview cannot drift from the real number.
  const preview = useMemo(
    () =>
      computeProposal({
        milestoneAmountMinor: amountMinor,
        criteria: criteria.map((c) => ({ id: c.key, weight: c.weight, required: c.required, partialCredit: c.partialCredit })),
        results: criteria.map((c) => ({ criterionId: c.key, outcome: state[c.key]!.outcome, credit: state[c.key]!.credit, confidence: 1 })),
        injectionFlagged: false,
        policy,
      }),
    [amountMinor, criteria, policy, state],
  );

  async function submit() {
    setError(null);
    if (note.trim().length < 3) {
      setError("Add a short note explaining the verdict (it goes into the ledger).");
      return;
    }
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/admin/milestones/${milestoneId}/verdict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note,
        results: criteria.map((c) => ({
          criterionKey: c.key,
          outcome: state[c.key]!.outcome,
          ...(state[c.key]!.outcome === "partial" ? { credit: state[c.key]!.credit } : {}),
          ...(state[c.key]!.reasoning.trim() ? { reasoning: state[c.key]!.reasoning.trim() } : {}),
        })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setConfirm(false);
      setError(body?.error?.message ?? "Couldn't record the verdict");
      return;
    }
    router.push(`/promises/${promiseId}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Criteria" description="Decide each one from the evidence" />
        <CardBody className="space-y-4">
          {criteria.map((c) => {
            const s = state[c.key]!;
            const set = (patch: Partial<typeof s>) => {
              setConfirm(false);
              setState({ ...state, [c.key]: { ...s, ...patch } });
            };
            return (
              <fieldset key={c.key} className="rounded-lg border border-line p-3">
                <legend className="sr-only">{c.title}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-subtle">{c.key}</span>
                  <span className="font-medium">{c.title}</span>
                  {c.required ? <Badge tone="warn">Required</Badge> : null}
                  <span className="tabular ml-auto text-xs text-ink-muted">weight {c.weight}</span>
                </div>
                <p className="mt-1 text-sm text-ink-muted">{c.description}</p>
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`Outcome for ${c.title}`}>
                  {(["pass", ...(c.partialCredit ? ["partial"] : []), "fail"] as Outcome[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={s.outcome === o}
                      onClick={() => set({ outcome: o })}
                      className={cn(
                        "h-9 rounded-lg border px-3 text-sm font-medium capitalize",
                        s.outcome === o
                          ? o === "pass"
                            ? "border-brand-600 bg-brand-50 text-brand-700"
                            : o === "fail"
                              ? "border-danger-600 bg-danger-50 text-danger-600"
                              : "border-warn-600 bg-warn-50 text-warn-600"
                          : "border-line text-ink-muted hover:bg-canvas",
                      )}
                    >
                      {o}
                    </button>
                  ))}
                  {s.outcome === "partial" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="range" min={5} max={95} step={5} value={Math.round(s.credit * 100)} onChange={(e) => set({ credit: Number(e.target.value) / 100 })} />
                      <span className="tabular w-10">{Math.round(s.credit * 100)}%</span>
                    </label>
                  ) : null}
                </div>
                <input
                  className="mt-3 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand-500"
                  placeholder="Reasoning (optional) — shown to both parties"
                  value={s.reasoning}
                  maxLength={500}
                  onChange={(e) => set({ reasoning: e.target.value })}
                />
              </fieldset>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Settlement preview" description="Computed by the deterministic settlement engine" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="tabular text-3xl font-semibold">{bpsToPercent(preview.releaseBps)}</p>
              <p className="text-sm text-ink-muted">release</p>
            </div>
            <dl className="tabular grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-muted">Capture</dt>
              <dd className="font-medium">{formatMoney(preview.captureMinor, currency)}</dd>
              <dt className="text-ink-muted">Released to client</dt>
              <dd>{formatMoney(amountMinor - preview.captureMinor, currency)}</dd>
              <dt className="text-ink-muted">Platform fee</dt>
              <dd>{formatMoney(preview.platformFeeMinor, currency)}</dd>
            </dl>
          </div>
          {preview.kind === "zero" ? (
            <Alert tone="warn" title={preview.blockedReason === "required_failed" ? "A required criterion failed" : "Nothing to release"}>
              Ahadi will void the PayPal authorization; the full hold goes back to the client.
            </Alert>
          ) : null}
          {preview.requiresHumanConfirm ? <Alert tone="warn" title="Above the human-confirmation threshold">You are confirming a high-value release.</Alert> : null}
          <label className="block">
            <span className="text-sm font-medium">Note for the ledger</span>
            <textarea
              className="mt-1 min-h-20 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500"
              value={note}
              maxLength={1000}
              onChange={(e) => {
                setNote(e.target.value);
                setConfirm(false);
              }}
              placeholder="e.g. Sandbox Phase 1 test — mobile layout overflows at 375px"
            />
          </label>
          {error ? <Alert tone="danger" title="Not recorded">{error}</Alert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void submit()} loading={submitting} variant={confirm ? "danger" : "primary"}>
              {confirm ? `Confirm: ${preview.captureMinor > 0 ? `capture ${formatMoney(preview.captureMinor, currency)}` : "void the hold"}` : "Record verdict and settle"}
            </Button>
            {confirm ? (
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
