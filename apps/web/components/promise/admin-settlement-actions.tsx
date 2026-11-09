"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function AdminSettlementActions({
  settlementId,
  status,
  error,
}: {
  settlementId: string;
  status: string;
  error: unknown;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(path: string, label: string) {
    setBusy(label);
    setMessage(null);
    const res = await fetch(path, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    setMessage(res.ok ? "Queued. Refresh in a few seconds." : (body?.error?.message ?? "Failed"));
    if (res.ok) setTimeout(() => router.refresh(), 2500);
  }

  if (status !== "FAILED" && status !== "CAPTURED") return null;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed border-line p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Admin</p>
      {status === "FAILED" && error ? (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-danger-600">
          {JSON.stringify(error, null, 2)}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "FAILED" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "retry"}
            onClick={() => void call(`/api/admin/settlements/${settlementId}/retry`, "retry")}
          >
            Retry settlement
          </Button>
        ) : null}
        {status === "CAPTURED" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "payout"}
            onClick={() => void call(`/api/admin/settlements/${settlementId}/payout`, "payout")}
          >
            Send / re-check payout
          </Button>
        ) : null}
      </div>
      {message ? <p className="text-xs text-ink-muted">{message}</p> : null}
    </div>
  );
}
