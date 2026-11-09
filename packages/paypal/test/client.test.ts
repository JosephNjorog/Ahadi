import { describe, expect, it, vi } from "vitest";
import {
  PayPalClient,
  PayPalError,
  authorizeOrder,
  captureAuthorization,
  createAuthorizeOrder,
  createPayoutBatch,
  extractAuthorization,
  verifyWebhookSignature,
  voidAuthorization,
} from "../src";

type Call = { url: string; init: RequestInit };
const silent = { info: () => {}, warn: () => {}, error: () => {} };

function mockFetch(responder: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    if (call.url.endsWith("/v1/oauth2/token")) {
      return json({ access_token: "A21AA-token", expires_in: 32400 });
    }
    return responder(call, calls.filter((c) => !c.url.endsWith("/oauth2/token")).length);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "paypal-debug-id": "dbg123", ...headers },
  });
}

const client = (f: typeof fetch) =>
  new PayPalClient({
    clientId: "id",
    clientSecret: "secret",
    env: "sandbox",
    fetch: f,
    logger: silent,
    backoffMs: 1,
  });

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe("PayPalClient", () => {
  it("creates an AUTHORIZE order with idempotency and representation headers", async () => {
    const m = mockFetch(() => json({ id: "ORDER1", status: "CREATED", intent: "AUTHORIZE" }, 201));
    const res = await createAuthorizeOrder(
      client(m.fn),
      {
        referenceId: "ms_1",
        customId: "promise_1:ms_1",
        description: "Ahadi milestone: Landing page v1",
        amount: { currency_code: "USD", value: "400.00" },
        returnUrl: "https://x/return",
        cancelUrl: "https://x/cancel",
      },
      "ahadi:order:ms_1:1",
    );
    expect(res.data.id).toBe("ORDER1");
    expect(res.debugId).toBe("dbg123");
    const call = m.calls.at(-1)!;
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(header(call, "PayPal-Request-Id")).toBe("ahadi:order:ms_1:1");
    expect(header(call, "Prefer")).toBe("return=representation");
    expect(header(call, "Authorization")).toBe("Bearer A21AA-token");
    const body = JSON.parse(String(call.init.body));
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "400.00" });
    expect(body.payment_source.paypal.experience_context.shipping_preference).toBe("NO_SHIPPING");
  });

  it("caches the OAuth token across calls", async () => {
    const m = mockFetch(() => json({ id: "O", status: "CREATED" }));
    const c = client(m.fn);
    await Promise.all([
      authorizeOrder(c, "O1", "k1"),
      authorizeOrder(c, "O2", "k2"),
      authorizeOrder(c, "O3", "k3"),
    ]);
    expect(m.calls.filter((x) => x.url.endsWith("/oauth2/token"))).toHaveLength(1);
  });

  it("extracts the authorization from an authorized order", () => {
    const auth = extractAuthorization({
      id: "O",
      status: "COMPLETED",
      intent: "AUTHORIZE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "1.00" },
          payments: {
            authorizations: [
              { id: "AUTH1", status: "CREATED", amount: { currency_code: "USD", value: "1.00" } },
            ],
          },
        },
      ],
    });
    expect(auth?.id).toBe("AUTH1");
  });

  it("sends partial final capture", async () => {
    const m = mockFetch(() =>
      json(
        {
          id: "CAP1",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "300.00" },
          seller_receivable_breakdown: {
            gross_amount: { currency_code: "USD", value: "300.00" },
            paypal_fee: { currency_code: "USD", value: "10.80" },
            net_amount: { currency_code: "USD", value: "289.20" },
          },
        },
        201,
      ),
    );
    const res = await captureAuthorization(
      client(m.fn),
      "AUTH1",
      {
        amount: { currency_code: "USD", value: "300.00" },
        finalCapture: true,
        invoiceId: "inv-1",
        noteToPayer: "75% released",
      },
      "ahadi:capture:p1",
    );
    expect(res.data.seller_receivable_breakdown?.net_amount?.value).toBe("289.20");
    const call = m.calls.at(-1)!;
    expect(call.url).toContain("/v2/payments/authorizations/AUTH1/capture");
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      final_capture: true,
      amount: { value: "300.00" },
    });
    expect(header(call, "PayPal-Request-Id")).toBe("ahadi:capture:p1");
  });

  it("accepts an empty 204 from void", async () => {
    const m = mockFetch(() => new Response(null, { status: 204 }));
    const res = await voidAuthorization(client(m.fn), "AUTH1", "ahadi:void:AUTH1");
    expect(res.status).toBe(204);
  });

  it("maps 422 into a non-retryable PayPalError with issue and debug id", async () => {
    const m = mockFetch(() =>
      json(
        {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "f00d",
          details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED", description: "already captured" }],
        },
        422,
      ),
    );
    const err = await captureAuthorization(
      client(m.fn),
      "A",
      { amount: { currency_code: "USD", value: "1.00" }, finalCapture: true },
      "k",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(422);
    expect(err.retryable).toBe(false);
    expect(err.debugId).toBe("f00d");
    expect(err.hasIssue("AUTHORIZATION_ALREADY_CAPTURED")).toBe(true);
    expect(m.calls.filter((c) => !c.url.endsWith("token"))).toHaveLength(1);
  });

  it("retries 5xx with the same idempotency key, then succeeds", async () => {
    const m = mockFetch((_c, n) =>
      n < 3
        ? json({ name: "INTERNAL_SERVER_ERROR", message: "x" }, 503)
        : json({ id: "O", status: "CREATED" }),
    );
    const res = await authorizeOrder(client(m.fn), "O", "ahadi:auth:O");
    expect(res.data.id).toBe("O");
    const writes = m.calls.filter((c) => !c.url.endsWith("token"));
    expect(writes).toHaveLength(3);
    expect(new Set(writes.map((w) => header(w, "PayPal-Request-Id")))).toEqual(new Set(["ahadi:auth:O"]));
  });

  it("refreshes the token once on 401", async () => {
    const m = mockFetch((_c, n) =>
      n === 1 ? json({ name: "AUTHENTICATION_FAILURE" }, 401) : json({ id: "O", status: "CREATED" }),
    );
    await authorizeOrder(client(m.fn), "O", "k");
    expect(m.calls.filter((c) => c.url.endsWith("token"))).toHaveLength(2);
  });

  it("raises a clear auth error for bad credentials", async () => {
    const f = vi.fn(async () =>
      json({ error: "invalid_client", error_description: "Client Authentication failed" }, 401),
    );
    const err = await authorizeOrder(client(f as unknown as typeof fetch), "O", "k").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.operation).toBe("oauth.token");
    expect(err.paypalName).toBe("invalid_client");
  });

  it("creates payout batches keyed on sender_batch_id", async () => {
    const m = mockFetch(() =>
      json(
        {
          batch_header: {
            payout_batch_id: "PB1",
            batch_status: "PENDING",
            sender_batch_header: { sender_batch_id: "ahadi_po_x" },
          },
        },
        201,
      ),
    );
    await createPayoutBatch(client(m.fn), {
      senderBatchId: "ahadi_po_x",
      emailSubject: "s",
      emailMessage: "m",
      items: [
        {
          receiverEmail: "w@x.test",
          amount: { value: "286.53", currency: "USD" },
          note: "n",
          senderItemId: "ahadi_po_x_0",
        },
      ],
    });
    const body = JSON.parse(String(m.calls.at(-1)!.init.body));
    expect(body.sender_batch_header.sender_batch_id).toBe("ahadi_po_x");
    expect(body.items[0]).toMatchObject({
      recipient_type: "EMAIL",
      receiver: "w@x.test",
      sender_item_id: "ahadi_po_x_0",
    });
  });
});

describe("verifyWebhookSignature", () => {
  const headers = {
    authAlgo: "SHA256withRSA",
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
    transmissionId: "t-1",
    transmissionSig: "sig==",
    transmissionTime: "2026-11-09T10:00:00Z",
  };

  it("embeds the raw body verbatim and returns true on SUCCESS", async () => {
    const m = mockFetch(() => json({ verification_status: "SUCCESS" }));
    const raw =
      '{"id":"WH-1","event_type":"PAYMENT.AUTHORIZATION.CREATED","resource":{"amount":{"value":"400.00"}},"summary":"caf\\u00e9"}';
    const ok = await verifyWebhookSignature(client(m.fn), { headers, rawBody: raw, webhookId: "WHID" });
    expect(ok).toBe(true);
    const sent = String(m.calls.at(-1)!.init.body);
    expect(sent.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(sent).webhook_id).toBe("WHID");
  });

  it("returns false on FAILURE and without headers", async () => {
    const m = mockFetch(() => json({ verification_status: "FAILURE" }));
    expect(await verifyWebhookSignature(client(m.fn), { headers, rawBody: "{}", webhookId: "W" })).toBe(
      false,
    );
    expect(
      await verifyWebhookSignature(client(m.fn), {
        headers: { ...headers, transmissionSig: null },
        rawBody: "{}",
        webhookId: "W",
      }),
    ).toBe(false);
  });
});
