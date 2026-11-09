import type { PayPalClient } from "./client";
import type { Authorization, Capture, Money } from "./types";

/** Payments v2 — authorizations (SPEC §6.4, §6.5). */

export async function getAuthorization(client: PayPalClient, authorizationId: string) {
  return client.request<Authorization>({
    operation: "authorizations.get",
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
  });
}

export interface CaptureAuthorizationInput {
  amount: Money;
  /** true → PayPal releases the uncaptured remainder of the hold to the buyer. */
  finalCapture: boolean;
  invoiceId?: string;
  noteToPayer?: string;
  softDescriptor?: string;
}

export async function captureAuthorization(
  client: PayPalClient,
  authorizationId: string,
  input: CaptureAuthorizationInput,
  requestId: string,
) {
  return client.request<Capture>({
    operation: "authorizations.capture",
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    body: {
      amount: input.amount,
      final_capture: input.finalCapture,
      ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
      ...(input.noteToPayer ? { note_to_payer: input.noteToPayer.slice(0, 255) } : {}),
      soft_descriptor: (input.softDescriptor ?? "AHADI").slice(0, 22),
    },
    requestId,
  });
}

/** Returns 204 (or 200 with representation). */
export async function voidAuthorization(client: PayPalClient, authorizationId: string, requestId: string) {
  return client.request<Authorization | Record<string, never>>({
    operation: "authorizations.void",
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    body: {},
    requestId,
    allowEmpty: true,
  });
}

/** Reauthorize after the 3-day honor period; returns a NEW authorization id. */
export async function reauthorize(
  client: PayPalClient,
  authorizationId: string,
  amount: Money,
  requestId: string,
) {
  return client.request<Authorization>({
    operation: "authorizations.reauthorize",
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`,
    body: { amount },
    requestId,
  });
}
