import type { PayPalClient } from "./client";
import type { CreatePayoutInput, PayoutBatch, PayoutItem } from "./types";

/** Payouts v1 (SPEC §6.6). PayPal dedupes batches on sender_batch_id. */

export async function createPayoutBatch(client: PayPalClient, input: CreatePayoutInput) {
  return client.request<PayoutBatch>({
    operation: "payouts.create",
    path: "/v1/payments/payouts",
    body: {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: input.emailSubject,
        email_message: input.emailMessage,
      },
      items: input.items.map((i) => ({
        recipient_type: "EMAIL",
        receiver: i.receiverEmail,
        amount: i.amount,
        note: i.note.slice(0, 4000),
        sender_item_id: i.senderItemId,
      })),
    },
    // sender_batch_id is the real idempotency key; the header guards the HTTP retry too.
    requestId: input.senderBatchId,
  });
}

export async function getPayoutBatch(client: PayPalClient, payoutBatchId: string) {
  return client.request<PayoutBatch>({
    operation: "payouts.get",
    path: `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`,
    query: { fields: "batch_header,items", page_size: 100 },
  });
}

export async function getPayoutItem(client: PayPalClient, payoutItemId: string) {
  return client.request<PayoutItem>({
    operation: "payouts.item.get",
    path: `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}`,
  });
}

/** Cancel an UNCLAIMED item so the funds return to the platform balance. */
export async function cancelUnclaimedPayoutItem(client: PayPalClient, payoutItemId: string) {
  return client.request<PayoutItem>({
    operation: "payouts.item.cancel",
    path: `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}/cancel`,
    body: {},
  });
}
