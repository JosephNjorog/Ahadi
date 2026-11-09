import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.APP_URL ??= "http://localhost:3000";
process.env.DEMO_MODE = "true";
process.env.DEMO_WORKER_PAYPAL_EMAIL = "worker-sandbox@ahadi.test";
process.env.LOG_LEVEL = "silent";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;

const { runMigrations } = await import("@ahadi/db/migrate");
const db = await import("@ahadi/db");
const { closeQueue, getQueue } = await import("@ahadi/queue");
const { closeBrowser } = await import("@ahadi/verifiers");
const svc = await import("../src");
const { seed, BAKERY_TERMS } = await import("../src/seed");
const { createFakePayPal } = await import("./fake-paypal");

const fake = createFakePayPal();
let server: Server;
let siteUrl = "";

beforeAll(async () => {
  await runMigrations(process.env.DATABASE_URL!);
  svc.setPayPalClient(fake.client);
  await seed({ resetFirst: true });
  await getQueue().obliterate({ force: true });
  server = createServer((req, res) => {
    if (req.method === "POST") return void res.writeHead(200).end("ok");
    res
      .writeHead(200, { "content-type": "text/html" })
      .end(
        readFileSync(fileURLToPath(new URL("../../../fixtures/bakery-site-v1/index.html", import.meta.url))),
      );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});

afterAll(async () => {
  server.close();
  await closeBrowser();
  await getQueue().obliterate({ force: true });
  await closeQueue();
  await db.closeDb();
});

const as = async (role: "client" | "worker" | "admin") => ({
  kind: "user" as const,
  user: await svc.demoUser(role),
});
let promiseId = "";
let milestoneId = "";

describe("Phase 2–3 promise flow (no AI configured)", () => {
  it("creates a promise; without AI the builder reports it and hand-written terms work", async () => {
    const p = await svc.createPromise(await as("client"), {
      brief:
        "Landing page for my bakery in Nairobi. Show cakes and prices; customers must be able to contact us; must work on phones.",
      category: "web",
      budgetUsd: 400,
    });
    promiseId = p.id;
    const [row] = await db.getDb().select().from(db.promises).where(eq(db.promises.id, p.id));
    expect(row!.termsStatus).toBe("failed");
    expect(row!.termsError).toMatch(/AI provider key/);
    const body = { ...BAKERY_TERMS, title: "Bakery landing page (flow test)" };
    const saved = await svc.proposeTermsEdit(await as("client"), p.id, {
      body,
      changeSummary: "Written by hand",
    });
    expect(saved.status).toBe("saved");
    // Budget mismatch is rejected in code.
    await expect(
      svc.proposeTermsEdit(await as("client"), p.id, {
        body: { ...body, milestones: [{ ...body.milestones[0]!, amountMinor: 50_000 }] },
      }),
    ).rejects.toThrow(/problems/);
  });

  it("invites, then requires both signatures on the same hash", async () => {
    await svc.inviteWorker(await as("client"), promiseId, (await svc.demoUser("worker")).email);
    const [p] = await db.getDb().select().from(db.promises).where(eq(db.promises.id, promiseId));
    expect(p!.state).toBe("NEGOTIATING");
    const [tv] = await db
      .getDb()
      .select()
      .from(db.termsVersions)
      .where(eq(db.termsVersions.id, p!.currentTermsVersionId!));
    await expect(svc.signTerms(await as("client"), promiseId, "0".repeat(64))).rejects.toThrow(
      /changed since you opened/,
    );
    expect((await svc.signTerms(await as("client"), promiseId, tv!.bodyHash)).agreed).toBe(false);
    expect((await svc.signTerms(await as("worker"), promiseId, tv!.bodyHash)).agreed).toBe(true);
    const [m] = await db.getDb().select().from(db.milestones).where(eq(db.milestones.promiseId, promiseId));
    milestoneId = m!.id;
    expect(m!.amountMinor).toBe(40_000);
  });

  it("funds and blocks submissions by the client", async () => {
    const { orderId } = await svc.createMilestoneOrder(await as("client"), milestoneId);
    await svc.authorizeMilestoneOrder(await as("client"), milestoneId, orderId);
    await expect(
      svc.submitWork(await as("client"), milestoneId, { kind: "url", url: siteUrl }),
    ).rejects.toThrow(/Only the worker/);
  });

  it("verifies v1 in a real browser: machine checks decide, AI criteria go to a human", async () => {
    const sub = await svc.submitWork(await as("worker"), milestoneId, { kind: "url", url: siteUrl });
    const r = await svc.runVerification(sub.id);
    expect(r.status).toBe("NEEDS_HUMAN");
    const view = await svc.getVerificationView(await as("client"), milestoneId);
    const byKey = Object.fromEntries(view.criteria.map((c) => [c.key, c.result]));
    expect(byKey.c1!.outcome).toBe("pass");
    expect(byKey.c4!.outcome).toBe("fail");
    expect(byKey.c4!.decidedBy).toBe("machine");
    expect(byKey.c2!.outcome).toBe("undetermined");
    expect(view.evidence.some((e) => e.kind === "screenshot")).toBe(true);
    expect(view.milestone.state).toBe("NEEDS_HUMAN");
  }, 120_000);

  it("client can't decide AI criteria; admin can, which publishes a 75% proposal", async () => {
    await expect(
      svc.reviewVerification(await as("client"), milestoneId, {
        decisions: [{ criterionKey: "c2", outcome: "pass", reasoning: "Looks right" }],
      }),
    ).rejects.toThrow(/Ahadi reviewer/);
    const res = await svc.reviewVerification(await as("admin"), milestoneId, {
      decisions: [
        {
          criterionKey: "c2",
          outcome: "pass",
          reasoning: "Hero shows the name and offer above the fold on both screenshots.",
        },
        { criterionKey: "c3", outcome: "pass", reasoning: "Six products with KES prices." },
      ],
    });
    expect(res.status).toBe("COMPLETE");
    const p = await svc.activeProposal(milestoneId);
    expect(p!.releaseBps).toBe(7500);
    expect(p!.captureMinor).toBe(30_000);
    const [m] = await db.getDb().select().from(db.milestones).where(eq(db.milestones.id, milestoneId));
    expect(m!.state).toBe("OBJECTION_WINDOW");
  });

  it("both parties accept → SETTLING → partial capture", async () => {
    expect((await svc.recordDecision(await as("client"), milestoneId, { decision: "accept" })).status).toBe(
      "OBJECTION_WINDOW",
    );
    expect((await svc.recordDecision(await as("worker"), milestoneId, { decision: "accept" })).status).toBe(
      "SETTLING",
    );
    const p = await svc.activeProposal(milestoneId);
    expect(await svc.executeSettlement(p!.id)).toBe("captured");
    const { verification, events } = await svc.getPromiseLedger(await as("client"), promiseId);
    expect(verification.valid).toBe(true);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "terms.signed",
        "promise.agreed",
        "submission.received",
        "verification.needs_human",
        "verification.human_reviewed",
        "proposal.published",
        "decision.recorded",
        "settlement.captured",
      ]),
    );
  });
});
