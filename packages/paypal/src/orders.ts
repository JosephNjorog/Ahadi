import type { PayPalClient } from "./client";
import type { Authorization, CreateOrderInput, Order } from "./types";

/** Orders v2 with intent AUTHORIZE (SPEC §6.3). */

export function buildAuthorizeOrderBody(input: CreateOrderInput) {
  return {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: input.referenceId,
        custom_id: input.customId,
        description: input.description.slice(0, 127),
        ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
        soft_descriptor: (input.softDescriptor ?? "AHADI").slice(0, 22),
        amount: input.amount,
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: input.brandName ?? "Ahadi",
          user_action: "CONTINUE",
          shipping_preference: "NO_SHIPPING",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
  };
}

export async function createAuthorizeOrder(client: PayPalClient, input: CreateOrderInput, requestId: string) {
  return client.request<Order>({
    operation: "orders.create",
    path: "/v2/checkout/orders",
    body: buildAuthorizeOrderBody(input),
    requestId,
  });
}

export async function getOrder(client: PayPalClient, orderId: string) {
  return client.request<Order>({
    operation: "orders.get",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
  });
}

/** POST /v2/checkout/orders/{id}/authorize — empty body. */
export async function authorizeOrder(client: PayPalClient, orderId: string, requestId: string) {
  return client.request<Order>({
    operation: "orders.authorize",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    body: {},
    requestId,
  });
}

/** The single authorization Ahadi creates per order. */
export function extractAuthorization(order: Order): Authorization | undefined {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}

export function approvalUrl(order: Order): string | undefined {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}
