import type { PayPalClient } from "./client";
import type { Webhook, WebhookSignatureHeaders } from "./types";

/** Webhooks (SPEC §6.7). */

export const SUBSCRIBED_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
] as const;

export function signatureHeadersFrom(get: (name: string) => string | null): WebhookSignatureHeaders {
  return {
    authAlgo: get("paypal-auth-algo"),
    certUrl: get("paypal-cert-url"),
    transmissionId: get("paypal-transmission-id"),
    transmissionSig: get("paypal-transmission-sig"),
    transmissionTime: get("paypal-transmission-time"),
  };
}

export function hasSignatureHeaders(h: WebhookSignatureHeaders): boolean {
  return Boolean(h.authAlgo && h.certUrl && h.transmissionId && h.transmissionSig && h.transmissionTime);
}

/**
 * POST /v1/notifications/verify-webhook-signature.
 * The raw request body is embedded verbatim — re-serialising the parsed event can change
 * escaping/number formatting and make a genuine event fail verification.
 */
export async function verifyWebhookSignature(
  client: PayPalClient,
  args: { headers: WebhookSignatureHeaders; rawBody: string; webhookId: string },
): Promise<boolean> {
  const { headers, rawBody, webhookId } = args;
  if (!hasSignatureHeaders(headers)) return false;
  JSON.parse(rawBody); // throws on non-JSON before we send it anywhere
  const envelope =
    `{"auth_algo":${JSON.stringify(headers.authAlgo)},` +
    `"cert_url":${JSON.stringify(headers.certUrl)},` +
    `"transmission_id":${JSON.stringify(headers.transmissionId)},` +
    `"transmission_sig":${JSON.stringify(headers.transmissionSig)},` +
    `"transmission_time":${JSON.stringify(headers.transmissionTime)},` +
    `"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${rawBody}}`;
  const res = await client.request<{ verification_status?: string }>({
    operation: "webhooks.verify",
    path: "/v1/notifications/verify-webhook-signature",
    rawJsonBody: envelope,
  });
  return res.data.verification_status === "SUCCESS";
}

export async function listWebhooks(client: PayPalClient) {
  return client.request<{ webhooks: Webhook[] }>({ operation: "webhooks.list", path: "/v1/notifications/webhooks" });
}

export async function createWebhook(client: PayPalClient, url: string, eventTypes: readonly string[] = SUBSCRIBED_EVENTS) {
  return client.request<Webhook>({
    operation: "webhooks.create",
    path: "/v1/notifications/webhooks",
    body: { url, event_types: eventTypes.map((name) => ({ name })) },
  });
}

export async function updateWebhookEvents(client: PayPalClient, webhookId: string, eventTypes: readonly string[] = SUBSCRIBED_EVENTS) {
  return client.request<Webhook>({
    method: "PATCH",
    operation: "webhooks.update",
    path: `/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`,
    body: [{ op: "replace", path: "/event_types", value: eventTypes.map((name) => ({ name })) }],
  });
}

export async function deleteWebhook(client: PayPalClient, webhookId: string) {
  return client.request<Record<string, never>>({
    method: "DELETE",
    operation: "webhooks.delete",
    path: `/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`,
    allowEmpty: true,
  });
}
