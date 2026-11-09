import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, sql } from "drizzle-orm";
import type { TermsBody } from "@ahadi/core";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const { hashTerms, validateTerms } = await import("@ahadi/core");
const { getEnv } = await import("@ahadi/core/env");
const db = await import("@ahadi/db");
const { appendLedgerEvent } = await import("@ahadi/ledger");

const {
  getDb,
  closeDb,
  users,
  promises,
  termsVersions,
  signatures,
  milestones,
  criteria,
  agents,
  mandates,
  services,
  passports,
} = db;

/** The demo promise from README "Running the demo": $400, one milestone, four criteria at 25 each. */
export const BAKERY_TERMS: TermsBody = {
  title: "Mama Njeri's Bakery — Landing Page",
  category: "web",
  currency: "USD",
  scopeSummary:
    "A one-page website for Mama Njeri's Bakery in Nairobi that shows the bakery's cakes with prices and lets customers send a message. It must work well on phones.",
  outOfScope: ["Online ordering or payments", "Domain purchase and hosting fees", "Logo design"],
  assumptions: [
    "Prices are shown in KES",
    "The client supplies product photos; stock photos are acceptable until then",
  ],
  milestones: [
    {
      position: 1,
      title: "Landing page v1",
      summary: "Live landing page at a public URL with hero, pricing and a working contact form.",
      amountMinor: 40_000,
      dueInDays: 3,
      deliverables: ["Public URL of the deployed landing page"],
      criteria: [
        {
          id: "c1",
          title: "Site is reachable at the submitted URL",
          description: "The submitted URL returns HTTP 200 and renders the landing page.",
          weight: 25,
          required: true,
          method: "automated",
          check: { kind: "http_ok" },
          evidence: ["dom_snapshot"],
          partialCredit: false,
        },
        {
          id: "c2",
          title: "Hero shows bakery name and offer",
          description:
            'The first screen shows the name "Mama Njeri\'s Bakery" and a one-line description of what it sells, visible without scrolling on desktop (900px) and mobile (812px).',
          weight: 25,
          required: false,
          method: "ai_judgment",
          evidence: ["screenshot_desktop", "screenshot_mobile", "dom_snapshot"],
          partialCredit: false,
        },
        {
          id: "c3",
          title: "Pricing lists at least 5 products in KES",
          description:
            "A pricing section lists at least 5 distinct products, each with a name and a price in KES. Placeholder text does not count.",
          weight: 25,
          required: false,
          method: "ai_judgment",
          evidence: ["screenshot_desktop", "dom_snapshot"],
          partialCredit: true,
        },
        {
          id: "c4",
          title: "Mobile layout works at 375px",
          description: "At a 375px-wide viewport the page has no horizontal scrolling.",
          weight: 25,
          required: false,
          method: "automated",
          check: { kind: "no_horizontal_scroll", viewportWidth: 375 },
          evidence: ["screenshot_mobile"],
          partialCredit: false,
        },
      ],
    },
  ],
};

async function upsertUser(email: string, displayName: string, extra: Partial<typeof users.$inferInsert>) {
  const d = getDb();
  const [u] = await d
    .insert(users)
    .values({ email, displayName, ...extra })
    .onConflictDoUpdate({ target: users.email, set: { displayName, ...extra } })
    .returning();
  return u!;
}

async function reset() {
  const d = getDb();
  // Order respects foreign keys. Only demo data lives in a fresh sandbox database.
  await d.execute(sql`
    truncate table payouts, settlements, proposals, criterion_results, artifacts, verifications, submissions,
      mediations, splits, fundings, criteria, signatures, ledger_events, milestones, terms_versions,
      promises, mandates, services, agent_actions, agents, risk_flags, webhook_events, job_failures, auth_tokens,
      agent_runs, passports, notifications, whatsapp_messages, ledger_anchors restart identity cascade
  `);
}

export async function seed({ resetFirst = false } = {}) {
  const env = getEnv();
  const d = getDb();
  if (resetFirst) await reset();

  const client = await upsertUser(env.DEMO_CLIENT_EMAIL, "Njeri Wanjiku (Client)", {
    country: "KE",
    paypalEmail: env.DEMO_BUYER_PAYPAL_EMAIL ?? null,
    passportSlug: "njeri",
  });
  const worker = await upsertUser(env.DEMO_WORKER_EMAIL, "Amani Otieno (Worker)", {
    country: "KE",
    paypalEmail: env.DEMO_WORKER_PAYPAL_EMAIL ?? null,
    passportSlug: "amani",
  });
  await upsertUser(env.DEMO_ADMIN_EMAIL, "Ahadi Admin", { role: "admin", country: "KE" });

  const existing = await d.select().from(promises).where(eq(promises.title, BAKERY_TERMS.title));
  if (existing.length > 0) {
    await seedAgentEconomy(client.id);
    console.log(`Demo promise already exists (${existing[0]!.id}). Use npm run demo:reset to start over.`);
    return existing[0]!.id;
  }

  const issues = validateTerms(BAKERY_TERMS, 40_000);
  if (issues.length) throw new Error(`Seed terms invalid: ${JSON.stringify(issues)}`);
  const bodyHash = hashTerms(BAKERY_TERMS);

  const promiseId = await d.transaction(async (tx) => {
    const [p] = await tx
      .insert(promises)
      .values({
        title: BAKERY_TERMS.title,
        category: "web",
        clientUserId: client.id,
        workerUserId: worker.id,
        state: "AGREED",
        currency: "USD",
        sourceBrief:
          "Landing page for my bakery in Nairobi. Show our cakes and prices, people should be able to contact us. Must work well on phones.",
      })
      .returning();
    await appendLedgerEvent(tx, {
      promiseId: p!.id,
      type: "promise.created",
      actor: `user:${client.id}`,
      payload: { title: p!.title, category: p!.category, client: client.id, worker: worker.id },
    });
    const [tv] = await tx
      .insert(termsVersions)
      .values({ promiseId: p!.id, version: 1, body: BAKERY_TERMS, bodyHash, authorId: null })
      .returning();
    await tx.update(promises).set({ currentTermsVersionId: tv!.id }).where(eq(promises.id, p!.id));
    await appendLedgerEvent(tx, {
      promiseId: p!.id,
      type: "terms.versioned",
      actor: "system",
      payload: { version: 1, bodyHash },
    });

    for (const m of BAKERY_TERMS.milestones) {
      const [row] = await tx
        .insert(milestones)
        .values({
          promiseId: p!.id,
          position: m.position,
          title: m.title,
          amountMinor: m.amountMinor,
          dueAt: m.dueInDays ? new Date(Date.now() + m.dueInDays * 86400_000) : null,
          maxAttempts: env.MAX_ATTEMPTS,
        })
        .returning();
      await tx.insert(criteria).values(
        m.criteria.map((c) => ({
          milestoneId: row!.id,
          key: c.id,
          spec: c,
          weight: c.weight,
          required: c.required,
        })),
      );
    }

    for (const [party, signer] of [
      ["client", client],
      ["worker", worker],
    ] as const) {
      await tx
        .insert(signatures)
        .values({ termsVersionId: tv!.id, party, signerUserId: signer.id, bodyHash });
      await appendLedgerEvent(tx, {
        promiseId: p!.id,
        type: "terms.signed",
        actor: `user:${signer.id}`,
        payload: { party, version: 1, bodyHash },
      });
    }
    await appendLedgerEvent(tx, {
      promiseId: p!.id,
      type: "promise.agreed",
      actor: "system",
      payload: { from: "NEGOTIATING", to: "AGREED", bodyHash },
    });
    return p!.id;
  });

  const ids = await d
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, [env.DEMO_CLIENT_EMAIL, env.DEMO_WORKER_EMAIL, env.DEMO_ADMIN_EMAIL]));
  console.log("Seeded users:", ids.map((u) => u.email).join(", "));
  console.log(`Seeded promise "${BAKERY_TERMS.title}" (${promiseId}), terms hash ${bodyHash.slice(0, 16)}…`);
  if (!env.DEMO_WORKER_PAYPAL_EMAIL)
    console.warn(
      "DEMO_WORKER_PAYPAL_EMAIL is empty — payouts will fail until the worker adds a PayPal email.",
    );
  return promiseId;
}

/** Kazi Research Agent (provider) with seeded verified history, and a buyer agent for the client (SPEC §14, §27). */
async function seedAgentEconomy(clientId: string) {
  const d = getDb();
  const { createHash, randomBytes } = await import("node:crypto");
  const kaziOwner = await upsertUser("kazi@ahadi.test", "Kazi Labs", {
    country: "KE",
    paypalEmail: process.env.DEMO_WORKER_PAYPAL_EMAIL ?? null,
    passportSlug: "kazi",
  });
  let [kazi] = await d.select().from(agents).where(eq(agents.name, "Kazi Research Agent"));
  if (!kazi) {
    const key = `ahk_${randomBytes(24).toString("base64url")}`;
    [kazi] = await d
      .insert(agents)
      .values({
        ownerId: kaziOwner.id,
        name: "Kazi Research Agent",
        kind: "provider",
        description: "Sourced research reports with verifiable citations.",
        providerWebhookUrl: "internal:kazi",
        apiKeyHash: createHash("sha256").update(key).digest("hex"),
        apiKeyPrefix: key.slice(0, 12),
      })
      .returning();
  }
  const [svc] = await d.select().from(services).where(eq(services.providerAgentId, kazi!.id));
  if (!svc) {
    await d.insert(services).values({
      providerUserId: kaziOwner.id,
      providerAgentId: kazi!.id,
      category: "research",
      title: "Sourced research report (1,000–2,000 words)",
      description:
        "A Markdown research report on any market or policy question, with numbered citations to real, reachable sources. Paid only if verification passes.",
      priceMinor: 2500,
      turnaroundHours: 1,
      defaultCriteria: [
        {
          id: "c1",
          title: "Cites at least 8 reachable sources",
          description: "The Sources list has at least 8 distinct URLs that resolve.",
          weight: 40,
          required: true,
          method: "automated",
          check: { kind: "min_citations", count: 8, mustResolve: true },
          evidence: ["citations"],
          partialCredit: false,
        },
        {
          id: "c2",
          title: "Length 1,000–2,000 words",
          description: "The report body is between 1,000 and 2,000 words.",
          weight: 20,
          required: false,
          method: "automated",
          check: { kind: "word_count", min: 1000, max: 2000 },
          evidence: ["text_content"],
          partialCredit: false,
        },
        {
          id: "c3",
          title: "Sampled claims are supported by their sources",
          description: "At least 4 of 5 sampled cited claims are supported by the fetched source text.",
          weight: 40,
          required: false,
          method: "ai_judgment",
          evidence: ["citations", "text_content"],
          partialCredit: true,
        },
      ],
    });
  }
  await d
    .insert(passports)
    .values({
      userId: kaziOwner.id,
      slug: "kazi",
      score: 0.86,
      stats: {
        displayName: "Kazi Labs",
        country: "KE",
        memberSince: new Date(Date.now() - 120 * 86400_000).toISOString(),
        lastActive: new Date().toISOString(),
        settledCount: 14,
        totalVerifiedMinor: 52_500,
        totalVerifiedBucket: "$500–1k",
        firstPassRate: 0.86,
        avgReleaseRate: 0.95,
        categories: { research: 14 },
        recentWork: [
          {
            title: "Kenya dairy cooperatives: market brief",
            category: "research",
            settledAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
            releasePct: 100,
            client: "A. M.",
          },
          {
            title: "East Africa solar cold storage operators",
            category: "research",
            settledAt: new Date(Date.now() - 9 * 86400_000).toISOString(),
            releasePct: 100,
            client: "J. K.",
          },
        ],
        disputes: { opened: 0, resolvedInFavor: 0 },
        agentProvider: true,
        seededDemoHistory: true,
      },
    })
    .onConflictDoNothing();

  // Buyer agent for the client, with a mandate (research only, $50/job, $200/month, provider score ≥ 0.7).
  const [buyer] = await d.select().from(agents).where(eq(agents.name, "Njeri's Assistant"));
  if (!buyer) {
    const key = `ahk_${randomBytes(24).toString("base64url")}`;
    const [b] = await d
      .insert(agents)
      .values({
        ownerId: clientId,
        name: "Njeri's Assistant",
        kind: "buyer",
        description: "Claude Desktop, hiring research for the bakery.",
        apiKeyHash: createHash("sha256").update(key).digest("hex"),
        apiKeyPrefix: key.slice(0, 12),
      })
      .returning();
    await d
      .insert(mandates)
      .values({
        agentId: b!.id,
        perJobMaxMinor: 5000,
        monthlyMaxMinor: 20_000,
        allowedCategories: ["research", "writing"],
        minProviderScore: 0.7,
        requireOwnerApprovalAboveMinor: null,
      });
    console.log(`\nBuyer agent API key (shown once — put it in your MCP client config):\n  ${key}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed({ resetFirst: process.argv.includes("--reset") })
    .then(() => closeDb())
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      process.exit(1);
    });
}
