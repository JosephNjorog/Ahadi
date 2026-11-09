import type { PayPalClient } from "./client";
import type { Capture, Money, Refund } from "./types";

/** Payments v2 — captures (SPEC §6.5 post-settlement correction). */

export async function getCapture(client: PayPalClient, captureId: string) {
  return client.request<Capture>({ operation: "captures.get", path: `/v2/payments/captures/${encodeURIComponent(captureId)}` });
}

export async function refundCapture(
  client: PayPalClient,
  captureId: string,
  input: { amount?: Money; noteToPayer?: string; invoiceId?: string },
  requestId: string,
) {
  return client.request<Refund>({
    operation: "captures.refund",
    path: `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    body: {
      ...(input.amount ? { amount: input.amount } : {}),
      ...(input.noteToPayer ? { note_to_payer: input.noteToPayer } : {}),
      ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
    },
    requestId,
  });
}
