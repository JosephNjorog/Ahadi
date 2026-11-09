"use client";

import { useEffect, useState } from "react";

/** Minimal typing of the PayPal JS SDK surface we use. */
export interface PayPalButtonsInstance {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
  isEligible(): boolean;
}
export interface PayPalNamespace {
  Buttons(options: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string; payerID?: string }) => Promise<void>;
    onCancel?: (data: { orderID: string }) => void;
    onError?: (err: unknown) => void;
  }): PayPalButtonsInstance;
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

type State =
  { status: "loading" } | { status: "ready"; paypal: PayPalNamespace } | { status: "error"; message: string };

const loaders = new Map<string, Promise<PayPalNamespace>>();

function load(src: string): Promise<PayPalNamespace> {
  const existing = loaders.get(src);
  if (existing) return existing;
  const p = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.namespace = "paypal";
    script.onload = () =>
      window.paypal
        ? resolve(window.paypal)
        : reject(new Error("PayPal SDK loaded without the paypal namespace"));
    script.onerror = () => {
      loaders.delete(src);
      reject(new Error("Couldn't load PayPal. Check your connection or disable blockers for paypal.com."));
    };
    document.head.appendChild(script);
  });
  loaders.set(src, p);
  return p;
}

/** Loads https://www.paypal.com/sdk/js with intent=authorize (SPEC §6.1). */
export function usePayPalSdk(clientId: string, currency: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    if (!clientId) {
      setState({
        status: "error",
        message: "PayPal client id is not configured (NEXT_PUBLIC_PAYPAL_CLIENT_ID).",
      });
      return;
    }
    const params = new URLSearchParams({
      "client-id": clientId,
      intent: "authorize",
      currency,
      components: "buttons",
      commit: "false",
    });
    let cancelled = false;
    load(`https://www.paypal.com/sdk/js?${params}`)
      .then((paypal) => !cancelled && setState({ status: "ready", paypal }))
      .catch((e: Error) => !cancelled && setState({ status: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [clientId, currency]);
  return state;
}
