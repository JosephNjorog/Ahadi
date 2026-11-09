import { PayPalClient } from "@ahadi/paypal";

/**
 * A stateful in-memory PayPal sandbox for integration tests. Implements just enough of
 * Orders v2, Payments v2 and Payouts v1 to exercise Ahadi's money spine, including
 * PayPal-Request-Id idempotency and final_capture semantics.
 */
export function createFakePayPal() {
  const orders = new Map<string, any>();
  const auths = new Map<string, any>();
  const captures = new Map<string, any>();
  const batches = new Map<string, any>();
  const idem = new Map<string, { status: number; body: unknown }>();
  const calls: { method: string; path: string; requestId: string | null; body: any }[] = [];
  let n = 0;
  const id = (p: string) => `${p}${(++n).toString().padStart(6, "0")}`;

  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "paypal-debug-id": `dbg${n}` },
    });

  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const requestId = headers.get("PayPal-Request-Id");
    if (url.pathname === "/v1/oauth2/token") return json(200, { access_token: "fake", expires_in: 3600 });
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, requestId, body });
    const key = requestId ? `${method}:${url.pathname}:${requestId}` : null;
    if (key && idem.has(key)) {
      const r = idem.get(key)!;
      return json(r.status, r.body);
    }
    const res = route(method, url.pathname, body);
    if (key && res.status < 500) idem.set(key, { status: res.status, body: res.body });
    return json(res.status, res.body);
  };

  function route(method: string, path: string, body: any): { status: number; body: any } {
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/v2/checkout/orders") {
      const o = {
        id: id("ORDER"),
        status: "CREATED",
        intent: body.intent,
        purchase_units: body.purchase_units.map((u: any) => ({ ...u })),
        links: [],
      };
      orders.set(o.id, o);
      return { status: 201, body: o };
    }
    if ((m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/))) {
      const o = orders.get(m[1]!);
      if (!o) return { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
      if (o.status === "COMPLETED")
        return {
          status: 422,
          body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_AUTHORIZED" }] },
        };
      const now = new Date();
      const a = {
        id: id("AUTH"),
        status: "CREATED",
        amount: o.purchase_units[0].amount,
        create_time: now.toISOString(),
        expiration_time: new Date(now.getTime() + 29 * 86400_000).toISOString(),
        captured: 0,
      };
      auths.set(a.id, a);
      o.status = "COMPLETED";
      o.payer = { email_address: "buyer@sandbox.test", payer_id: "PAYER1" };
      o.purchase_units[0].payments = { authorizations: [a] };
      return { status: 201, body: o };
    }
    if ((m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/)))
      return orders.has(m[1]!) ? { status: 200, body: orders.get(m[1]!) } : { status: 404, body: {} };
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/))) {
      const a = auths.get(m[1]!);
      if (!a) return { status: 404, body: {} };
      if (a.status === "CAPTURED" || a.status === "VOIDED")
        return {
          status: 422,
          body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED" }] },
        };
      const value = Math.round(Number(body.amount.value) * 100);
      const auth = Math.round(Number(a.amount.value) * 100);
      if (value + a.captured > auth)
        return {
          status: 422,
          body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "MAX_CAPTURE_AMOUNT_EXCEEDED" }] },
        };
      a.captured += value;
      a.status = body.final_capture ? "CAPTURED" : "PARTIALLY_CAPTURED";
      const fee = Math.round(value * 0.0349) + 49;
      const c = {
        id: id("CAP"),
        status: "COMPLETED",
        amount: body.amount,
        final_capture: body.final_capture,
        seller_receivable_breakdown: {
          gross_amount: body.amount,
          paypal_fee: { currency_code: "USD", value: (fee / 100).toFixed(2) },
          net_amount: { currency_code: "USD", value: ((value - fee) / 100).toFixed(2) },
        },
      };
      captures.set(c.id, c);
      return { status: 201, body: c };
    }
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/))) {
      const a = auths.get(m[1]!);
      if (!a) return { status: 404, body: {} };
      if (a.status === "CAPTURED")
        return {
          status: 422,
          body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED" }] },
        };
      a.status = "VOIDED";
      return { status: 204, body: null };
    }
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)$/)))
      return auths.has(m[1]!) ? { status: 200, body: auths.get(m[1]!) } : { status: 404, body: {} };
    if (method === "POST" && path === "/v1/payments/payouts") {
      const existing = [...batches.values()].find(
        (b) =>
          b.batch_header.sender_batch_header.sender_batch_id === body.sender_batch_header.sender_batch_id,
      );
      if (existing)
        return {
          status: 400,
          body: { name: "USER_BUSINESS_ERROR", details: [{ issue: "SENDER_BATCH_ID_ALREADY_USED" }] },
        };
      const b = {
        batch_header: {
          payout_batch_id: id("BATCH"),
          batch_status: "PENDING",
          sender_batch_header: body.sender_batch_header,
        },
        items: body.items.map((i: any) => ({
          payout_item_id: id("ITEM"),
          transaction_status: "PENDING",
          payout_batch_id: "",
          payout_item: {
            receiver: i.receiver,
            sender_item_id: i.sender_item_id,
            amount: i.amount,
            note: i.note,
          },
        })),
      };
      b.items.forEach((i: any) => (i.payout_batch_id = b.batch_header.payout_batch_id));
      batches.set(b.batch_header.payout_batch_id, b);
      return { status: 201, body: { batch_header: b.batch_header } };
    }
    if ((m = path.match(/^\/v1\/payments\/payouts\/([^/]+)$/)))
      return batches.has(m[1]!) ? { status: 200, body: batches.get(m[1]!) } : { status: 404, body: {} };
    return { status: 404, body: { name: "NOT_IMPLEMENTED_IN_FAKE", path } };
  }

  const silent = { info() {}, warn() {}, error() {} };
  const client = new PayPalClient({
    clientId: "fake",
    clientSecret: "fake",
    env: "sandbox",
    fetch: fetchImpl as typeof fetch,
    logger: silent,
    backoffMs: 1,
  });

  return {
    client,
    calls,
    orders,
    auths,
    captures,
    batches,
    /** Simulate the payout processor finishing every item. */
    completePayouts(status = "SUCCESS") {
      for (const b of batches.values()) {
        b.batch_header.batch_status = "SUCCESS";
        for (const i of b.items) i.transaction_status = status;
      }
    },
  };
}
