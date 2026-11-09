import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.APP_URL ??= "http://localhost:3000";
process.env.DEMO_MODE = "true";
process.env.DEMO_WORKER_PAYPAL_EMAIL = "worker-sandbox@ahadi.test";
process.env.DEMO_BUYER_PAYPAL_EMAIL = "buyer-sandbox@ahadi.test";
process.env.PLATFORM_FEE_BPS = "150";
process.env.LOG_LEVEL = "silent";

const { runMigrations } = await import("@ahadi/db/migrate");
const db = await import("@ahadi/db");
const { closeQueue, getQueue } = await import("@ahadi/queue");
const svc = await import("../src");
const { seed } = await import("../src/seed");
const { createFakePayPal } = await import("./fake-paypal");

const fake = createFakePayPal();
let promiseId: string;
let milestoneId: string;

beforeAll(async () => {
  await runMigrations(process.env.DATABASE_URL!);
  svc.setPayPalClient(fake.client);
  promiseId = await seed({ resetFirst: true });
  const [m] = await db.getDb().select().from(db.milestones).where(eq(db.milestones.promiseId, promiseId));
  milestoneId = m!.id;
  await getQueue().obliterate({ force: true });
});

afterAll(async () => {
  await getQueue().obliterate({ force: true });
  await closeQueue();
  await db.closeDb();
});

const asUser = async (role: "client" | "worker" | "admin") => ({
  kind: "user" as const,
  user: await svc.demoUser(role),
});
const milestone = async () =>
  (await db.getDb().select().from(db.milestones).where(eq(db.milestones.id, milestoneId)))[0]!;

describe("Phase 1 money spine (fake PayPal, real Postgres + Redis)", () => {
  it("refuses funding by the worker", async () => {
    await expect(svc.createMilestoneOrder(await asUser("worker"), milestoneId)).rejects.toThrow(
      /Only the client/,
    );
  });

  it("client funds $400: order → authorize → FUNDED, promise ACTIVE", async () => {
    const client = await asUser("client");
    const { orderId } = await svc.createMilestoneOrder(client, milestoneId);
    expect((await milestone()).state).toBe("FUNDING");
    expect(fake.calls.at(-1)!.requestId).toBe(`ahadi:order:${milestoneId}:1`);

    const funding = await svc.authorizeMilestoneOrder(client, milestoneId, orderId);
    expect(funding.status).toBe("AUTHORIZED");
    expect(funding.paypalAuthorizationId).toMatch(/^AUTH/);
    expect(funding.honorExpiresAt!.getTime() - Date.now()).toBeGreaterThan(2.9 * 86400_000);
    expect((await milestone()).state).toBe("FUNDED");
    const [p] = await db.getDb().select().from(db.promises).where(eq(db.promises.id, promiseId));
    expect(p!.state).toBe("ACTIVE");

    // Authorizing again (e.g. double click) is a no-op.
    const again = await svc.authorizeMilestoneOrder(client, milestoneId, orderId);
    expect(again.id).toBe(funding.id);
  });

  it("webhook for the same authorization is idempotent", async () => {
    const [f] = await db.getDb().select().from(db.fundings).where(eq(db.fundings.milestoneId, milestoneId));
    const auth = fake.auths.get(f!.paypalAuthorizationId!)!;
    await db
      .getDb()
      .insert(db.webhookEvents)
      .values({
        id: "WH-AUTH-1",
        eventType: "PAYMENT.AUTHORIZATION.CREATED",
        resourceId: auth.id,
        verified: true,
        payload: {
          id: "WH-AUTH-1",
          event_type: "PAYMENT.AUTHORIZATION.CREATED",
          create_time: new Date().toISOString(),
          resource_type: "authorization",
          resource: { ...auth, supplementary_data: { related_ids: { order_id: f!.paypalOrderId } } },
        },
      });
    expect(await svc.processWebhookEvent("WH-AUTH-1")).toBe("already_secured");
    expect(await svc.processWebhookEvent("WH-AUTH-1")).toBe("already_processed");
  });

  it("admin verdict 3/4 → 75% proposal → SETTLING", async () => {
    const res = await svc.submitManualVerdict(await asUser("admin"), {
      milestoneId,
      note: "Phase 1 sandbox test: mobile layout fails at 375px",
      results: [
        { criterionKey: "c1", outcome: "pass" },
        { criterionKey: "c2", outcome: "pass" },
        { criterionKey: "c3", outcome: "pass" },
        { criterionKey: "c4", outcome: "fail", reasoning: "Horizontal scroll at 375px" },
      ],
    });
    expect(res.computed.releaseBps).toBe(7500);
    expect(res.proposal.captureMinor).toBe(30_000);
    expect(res.proposal.platformFeeMinor).toBe(450);
    expect((await milestone()).state).toBe("SETTLING");
  });

  it("executes partial final capture of $300 and queues payout", async () => {
    const [proposal] = await db.getDb().select().from(db.proposals);
    expect(await svc.executeSettlement(proposal!.id)).toBe("captured");
    const capCall = fake.calls.find((c) => c.path.endsWith("/capture"))!;
    expect(capCall.body).toMatchObject({
      amount: { value: "300.00", currency_code: "USD" },
      final_capture: true,
    });
    expect(capCall.requestId).toBe(`ahadi:capture:${proposal!.id}`);
    const [s] = await db.getDb().select().from(db.settlements);
    expect(s!.status).toBe("CAPTURED");
    expect(s!.capturedMinor).toBe(30_000);
    expect(s!.paypalFeeMinor).toBe(Math.round(30_000 * 0.0349) + 49);
    // Re-running is a no-op (job retry after a crash).
    expect(await svc.executeSettlement(proposal!.id)).toBe("already_done");
    expect(fake.calls.filter((c) => c.path.endsWith("/capture"))).toHaveLength(1);
    const job = await getQueue().getJob(`payout-${s!.id}`);
    expect(job?.name).toBe("payout.send");
  });

  it("pays the worker net − platform fee and settles after the payout succeeds", async () => {
    const [s] = await db.getDb().select().from(db.settlements);
    expect((await svc.sendPayout(s!.id)).status).toBe("sent");
    expect((await svc.sendPayout(s!.id)).status).toBe("already_sent");
    const [p] = await db.getDb().select().from(db.payouts);
    const expected = s!.netMinor! - 450;
    expect(p!.amountMinor).toBe(expected);
    expect(p!.recipientPaypalEmail).toBe("worker-sandbox@ahadi.test");
    const payoutCall = fake.calls.find((c) => c.path === "/v1/payments/payouts")!;
    expect(payoutCall.body.items[0].amount.value).toBe((expected / 100).toFixed(2));

    expect((await milestone()).state).toBe("SETTLING");
    fake.completePayouts();
    const r = await svc.reconcilePayouts();
    expect(r.updated).toBe(1);
    expect((await milestone()).state).toBe("SETTLED");
    const [promise] = await db.getDb().select().from(db.promises).where(eq(db.promises.id, promiseId));
    expect(promise!.state).toBe("COMPLETED");
  });

  it("leaves an intact, complete ledger chain", async () => {
    const { events, verification } = await svc.getPromiseLedger(await asUser("client"), promiseId);
    expect(verification.valid).toBe(true);
    const types = events.map((e) => e.type);
    for (const t of [
      "promise.created",
      "terms.signed",
      "funding.order_created",
      "funding.secured",
      "promise.activated",
      "proposal.published",
      "settlement.captured",
      "payout.sent",
      "payout.succeeded",
      "milestone.settled",
      "promise.completed",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("admin overview reconciles the money map", async () => {
    const o = await svc.getAdminOverview();
    expect(o.money.authorizedMinor).toBe(40_000);
    expect(o.money.capturedMinor).toBe(30_000);
    expect(o.money.heldMinor).toBe(0);
    expect(o.money.paidOutMinor).toBeGreaterThan(0);
  });
});

describe("zero release voids the hold", () => {
  it("required criterion fails → void → VOIDED", async () => {
    promiseId = await seed({ resetFirst: true });
    const [m] = await db.getDb().select().from(db.milestones).where(eq(db.milestones.promiseId, promiseId));
    milestoneId = m!.id;
    const client = await asUser("client");
    const { orderId } = await svc.createMilestoneOrder(client, milestoneId);
    await svc.authorizeMilestoneOrder(client, milestoneId, orderId);
    const res = await svc.submitManualVerdict(await asUser("admin"), {
      milestoneId,
      note: "Site never came up",
      results: [
        { criterionKey: "c1", outcome: "fail" },
        { criterionKey: "c2", outcome: "pass" },
        { criterionKey: "c3", outcome: "pass" },
        { criterionKey: "c4", outcome: "pass" },
      ],
    });
    expect(res.computed.blockedReason).toBe("required_failed");
    expect(await svc.executeSettlement(res.proposal.id)).toBe("voided");
    expect((await milestone()).state).toBe("VOIDED");
    expect([...fake.auths.values()].at(-1)!.status).toBe("VOIDED");
  });
});
