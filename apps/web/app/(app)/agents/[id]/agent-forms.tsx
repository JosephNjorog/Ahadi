"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, ApiError, detailLines } from "@/lib/client";
import { KeyReveal } from "../key-reveal";

const CATS = ["web", "code", "design", "writing", "research", "data"] as const;

type M = {
  perJobMaxUsd: number;
  monthlyMaxUsd: number;
  allowedCategories: string[];
  minProviderScore: number;
  requireOwnerApprovalAboveUsd: number | null;
  active: boolean;
};

export function MandateForm({ agentId, initial }: { agentId: string; initial: M | null }) {
  const router = useRouter();
  const [m, setM] = useState<M>(
    initial ?? {
      perJobMaxUsd: 50,
      monthlyMaxUsd: 200,
      allowedCategories: ["research"],
      minProviderScore: 0.7,
      requireOwnerApprovalAboveUsd: null,
      active: true,
    },
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "brand" | "danger"; text: string } | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (m.perJobMaxUsd > m.monthlyMaxUsd)
          return setMsg({ tone: "danger", text: "The per-job limit can't exceed the monthly limit." });
        if (!m.allowedCategories.length)
          return setMsg({ tone: "danger", text: "Allow at least one category." });
        setBusy(true);
        setMsg(null);
        try {
          await api(`/api/agents/${agentId}/mandate`, { method: "PUT", body: m });
          setMsg({ tone: "brand", text: "Mandate saved." });
          router.refresh();
        } catch (err) {
          setMsg({
            tone: "danger",
            text: [(err as Error).message, ...(err instanceof ApiError ? detailLines(err.details) : [])].join(
              " · ",
            ),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Per-job maximum (USD)">
          <Input
            inputMode="decimal"
            value={String(m.perJobMaxUsd)}
            onChange={(e) => setM({ ...m, perJobMaxUsd: Number(e.target.value || 0) })}
          />
        </Field>
        <Field label="Monthly maximum (USD)">
          <Input
            inputMode="decimal"
            value={String(m.monthlyMaxUsd)}
            onChange={(e) => setM({ ...m, monthlyMaxUsd: Number(e.target.value || 0) })}
          />
        </Field>
        <Field label="Minimum provider score (0–1)" hint="From the provider's Ahadi Passport">
          <Input
            inputMode="decimal"
            value={String(m.minProviderScore)}
            onChange={(e) =>
              setM({ ...m, minProviderScore: Math.min(1, Math.max(0, Number(e.target.value || 0))) })
            }
          />
        </Field>
        <Field label="Flag jobs above (USD, optional)" hint="Marked for extra owner attention">
          <Input
            inputMode="decimal"
            value={m.requireOwnerApprovalAboveUsd == null ? "" : String(m.requireOwnerApprovalAboveUsd)}
            onChange={(e) =>
              setM({ ...m, requireOwnerApprovalAboveUsd: e.target.value ? Number(e.target.value) : null })
            }
          />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Allowed categories</legend>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {CATS.map((c) => (
            <label key={c} className="flex items-center gap-1.5 capitalize">
              <input
                type="checkbox"
                checked={m.allowedCategories.includes(c)}
                onChange={(e) =>
                  setM({
                    ...m,
                    allowedCategories: e.target.checked
                      ? [...m.allowedCategories, c]
                      : m.allowedCategories.filter((x) => x !== c),
                  })
                }
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={m.active}
          onChange={(e) => setM({ ...m, active: e.target.checked })}
        />{" "}
        Mandate active (uncheck to pause all spending)
      </label>
      {msg ? <Alert tone={msg.tone} title={msg.text} /> : null}
      <Button type="submit" loading={busy}>
        Save mandate
      </Button>
    </form>
  );
}

export function AgentActions({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (key)
    return (
      <div className="w-full">
        <KeyReveal apiKey={key} />
      </div>
    );
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="secondary"
        loading={busy === "rotate"}
        onClick={async () => {
          if (!window.confirm("Rotate the key? The old key stops working immediately.")) return;
          setBusy("rotate");
          const r = await api<{ apiKey: string }>(`/api/agents/${agentId}/rotate`, { body: {} }).finally(() =>
            setBusy(null),
          );
          setKey(r.apiKey);
        }}
      >
        Rotate key
      </Button>
      <Button
        size="sm"
        variant="danger"
        loading={busy === "revoke"}
        onClick={async () => {
          if (!window.confirm("Revoke this agent? It loses access immediately.")) return;
          setBusy("revoke");
          await api(`/api/agents/${agentId}`, { method: "DELETE" }).finally(() => setBusy(null));
          router.refresh();
        }}
      >
        Revoke
      </Button>
    </div>
  );
}
