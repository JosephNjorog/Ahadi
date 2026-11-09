"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Spinner } from "@/components/ui";
import { usePayPalSdk } from "./use-paypal-sdk";

type Phase =
  | { k: "idle" }
  | { k: "creating" }
  | { k: "authorizing" }
  | { k: "secured"; authorizationId: string }
  | { k: "cancelled" }
  | { k: "error"; message: string; debugId?: string };

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message ?? `Request failed (${res.status})`) as Error & { debugId?: string };
    err.debugId = json?.error?.details?.debugId;
    throw err;
  }
  return json as T;
}

export function FundWithPayPal({
  milestoneId,
  clientId,
  currency,
  amountLabel,
  returnOrderId,
  returnStatus,
}: {
  milestoneId: string;
  clientId: string;
  currency: string;
  amountLabel: string;
  /** Set when PayPal redirected back (full-page flow, e.g. popup blocked on mobile). */
  returnOrderId?: string;
  returnStatus?: "return" | "cancel";
}) {
  const router = useRouter();
  const sdk = usePayPalSdk(clientId, currency);
  const container = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const handledReturn = useRef(false);

  const authorize = useCallback(
    async (orderId: string) => {
      setPhase({ k: "authorizing" });
      try {
        const r = await post<{ authorizationId: string; status: string }>(`/api/milestones/${milestoneId}/authorize`, { orderId });
        if (r.status === "APPROVED") {
          setPhase({ k: "error", message: "PayPal is still reviewing this payment. We'll mark the funds secured as soon as PayPal confirms." });
        } else {
          setPhase({ k: "secured", authorizationId: r.authorizationId });
        }
        router.refresh();
      } catch (e) {
        const err = e as Error & { debugId?: string };
        setPhase({ k: "error", message: err.message, debugId: err.debugId });
      }
    },
    [milestoneId, router],
  );

  // Full-page redirect return.
  useEffect(() => {
    if (handledReturn.current || !returnOrderId || !returnStatus) return;
    handledReturn.current = true;
    if (returnStatus === "return") void authorize(returnOrderId);
    else {
      void post(`/api/milestones/${milestoneId}/cancel`, { orderId: returnOrderId }).catch(() => undefined);
      setPhase({ k: "cancelled" });
    }
  }, [authorize, milestoneId, returnOrderId, returnStatus]);

  useEffect(() => {
    if (sdk.status !== "ready" || !container.current || returnOrderId) return;
    const el = container.current;
    const buttons = sdk.paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal", height: 48 },
      createOrder: async () => {
        setPhase({ k: "creating" });
        try {
          const { orderId } = await post<{ orderId: string }>(`/api/milestones/${milestoneId}/order`);
          setPhase({ k: "idle" });
          return orderId;
        } catch (e) {
          const err = e as Error & { debugId?: string };
          setPhase({ k: "error", message: err.message, debugId: err.debugId });
          throw e;
        }
      },
      onApprove: async ({ orderID }) => authorize(orderID),
      onCancel: ({ orderID }) => {
        setPhase({ k: "cancelled" });
        void post(`/api/milestones/${milestoneId}/cancel`, { orderId: orderID }).catch(() => undefined);
        router.refresh();
      },
      onError: (err) => {
        setPhase((p) => (p.k === "error" ? p : { k: "error", message: "PayPal couldn't complete the checkout. Please try again." }));
        console.error("PayPal Buttons error", err);
      },
    });
    if (buttons.isEligible()) {
      el.innerHTML = "";
      void buttons.render(el);
    }
    return () => {
      void buttons.close().catch(() => undefined);
    };
  }, [sdk, milestoneId, authorize, router, returnOrderId]);

  if (phase.k === "secured") {
    return (
      <Alert tone="brand" title={`Funds secured (${amountLabel})`}>
        PayPal is holding the money. Nothing is captured until the work is verified. Authorization <span className="font-mono">{phase.authorizationId}</span>.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {phase.k === "authorizing" ? (
        <Alert tone="info" title="Securing funds…">
          <span className="inline-flex items-center gap-2">
            <Spinner className="size-4" /> Confirming the authorization with PayPal. Don't close this page.
          </span>
        </Alert>
      ) : null}
      {phase.k === "cancelled" ? <Alert tone="warn" title="Checkout cancelled">No money was held. You can try again whenever you're ready.</Alert> : null}
      {phase.k === "error" ? (
        <Alert tone="danger" title="Funding didn't complete" action={<Button size="sm" variant="secondary" onClick={() => setPhase({ k: "idle" })}>Dismiss</Button>}>
          {phase.message}
          {phase.debugId ? <span className="mt-1 block font-mono text-xs">PayPal debug id {phase.debugId}</span> : null}
        </Alert>
      ) : null}

      {sdk.status === "loading" ? (
        <div className="flex h-28 items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm text-ink-muted">
          <Spinner className="size-4" /> Loading PayPal…
        </div>
      ) : null}
      {sdk.status === "error" ? <Alert tone="danger" title="PayPal unavailable">{sdk.message}</Alert> : null}
      <div ref={container} className={phase.k === "authorizing" || phase.k === "creating" ? "pointer-events-none opacity-60" : undefined} aria-label="PayPal checkout" />
      <p className="text-xs text-ink-subtle">
        You approve an <strong>authorization</strong>, not a payment. PayPal holds {amountLabel}; Ahadi captures only the verified share and the rest is released back to you.
      </p>
    </div>
  );
}
