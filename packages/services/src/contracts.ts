import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  CategorySchema,
  TermsBodySchema,
  dollarsToMinor,
  hashTerms,
  validateTerms,
  type Criterion,
  type TermsBody,
} from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import { anthropicConfigured, critiqueContract, draftContract, type CriteriaCritique } from "@ahadi/agents";
import {
  criteria,
  getDb,
  milestones,
  promises,
  services,
  signatures,
  termsVersions,
  users,
  type Tx,
} from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { enqueue } from "@ahadi/queue";
import { actorTag, actorUserId, assertParty, partyRole, type Actor } from "./actor";
import { log } from "./log";
import { notify } from "./notify";
import { applyPromiseEvent } from "./transitions";

/* ─────────────── Create (SPEC §16 POST /api/promises) ─────────────── */

export const CreatePromiseInput = z.object({
  title: z.string().trim().max(120).optional(),
  brief: z.string().trim().min(20, "Describe the job in at least a sentence or two").max(8000),
  category: CategorySchema,
  budgetUsd: z.number().positive().max(100_000),
  currency: z.literal("USD").default("USD"),
  deadline: z.coerce.date().optional(),
  workerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  serviceId: z.string().uuid().optional(),
  workerAgentId: z.string().uuid().optional(),
});
export type CreatePromiseInput = z.infer<typeof CreatePromiseInput>;

export async function createPromise(actor: Actor, raw: unknown) {
  const input = CreatePromiseInput.parse(raw);
  const db = getDb();
  if (actor.kind !== "user" && actor.kind !== "agent")
    throw new AppError("FORBIDDEN", "Only people and agents create promises");
  if (input.deadline && input.deadline.getTime() < Date.now() + 3600_000)
    throw new AppError("VALIDATION_FAILED", "Deadline must be in the future");

  let service: typeof services.$inferSelect | undefined;
  if (input.serviceId) {
    [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.active, true)));
    if (!service) throw new AppError("NOT_FOUND", "Service not found");
  }
  const budgetMinor = dollarsToMinor(input.budgetUsd);

  const promise = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(promises)
      .values({
        title: input.title || summarizeTitle(input.brief),
        category: input.category,
        clientUserId: actor.kind === "user" ? actor.user.id : actor.owner.id,
        clientAgentId: actor.kind === "agent" ? actor.agent.id : null,
        workerUserId: service?.providerUserId ?? null,
        workerAgentId: service?.providerAgentId ?? input.workerAgentId ?? null,
        currency: input.currency,
        sourceBrief: input.brief,
        budgetMinor,
        deadlineAt: input.deadline ?? null,
        inviteEmail: input.workerEmail ?? null,
        serviceId: service?.id ?? null,
        termsStatus: "generating",
      })
      .returning();
    await appendLedgerEvent(tx, {
      promiseId: p!.id,
      type: "promise.created",
      actor: actorTag(actor),
      payload: {
        title: p!.title,
        category: p!.category,
        budgetMinor,
        currency: p!.currency,
        serviceId: service?.id ?? null,
      },
    });
    return p!;
  });

  if (input.workerEmail) await attachWorkerByEmail(promise.id, input.workerEmail);
  await requestTermsGeneration(promise.id, { authorId: actorUserId(actor) });
  await enqueue("risk.score", { promiseId: promise.id, trigger: "created" }).catch(() => undefined);
  return promise;
}

function summarizeTitle(brief: string): string {
  const first = brief.split(/[.\n!?]/)[0]!.trim();
  return first.length > 80 ? `${first.slice(0, 77)}…` : first || "Untitled promise";
}

/* ─────────────── Contract Architect job (SPEC §17 contract.generate) ─────────────── */

export async function requestTermsGeneration(
  promiseId: string,
  opts: { editRequest?: string; authorId?: string | null } = {},
) {
  await getDb()
    .update(promises)
    .set({ termsStatus: "generating", termsError: null })
    .where(eq(promises.id, promiseId));
  if (!anthropicConfigured()) {
    await getDb()
      .update(promises)
      .set({
        termsStatus: "failed",
        termsError: "The AI contract builder needs ANTHROPIC_API_KEY. You can still write the terms by hand.",
      })
      .where(eq(promises.id, promiseId));
    return;
  }
  await enqueue("contract.generate", {
    promiseId,
    editRequest: opts.editRequest,
    authorId: opts.authorId ?? null,
    requestKey: randomUUID(),
  });
}

/** Architect → code validation → new terms version → Critic (once; humans decide after that). */
export async function generateTerms(promiseId: string, editRequest?: string, authorId?: string | null) {
  const db = getDb();
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  if (!p) throw new AppError("NOT_FOUND", "Promise not found");
  if (!["DRAFT", "NEGOTIATING"].includes(p.state)) {
    await db.update(promises).set({ termsStatus: "idle" }).where(eq(promises.id, promiseId));
    return null;
  }
  const previous = p.currentTermsVersionId
    ? (await db.select().from(termsVersions).where(eq(termsVersions.id, p.currentTermsVersionId)))[0]
    : undefined;
  let template: unknown;
  if (p.serviceId)
    template = (await db.select().from(services).where(eq(services.id, p.serviceId)))[0]?.defaultCriteria;

  try {
    const { draft, body } = await draftContract({
      promiseId,
      brief: p.sourceBrief ?? p.title,
      category: p.category,
      budgetMinor: p.budgetMinor ?? previous?.body.milestones.reduce((s, m) => s + m.amountMinor, 0) ?? 0,
      currency: p.currency,
      deadline: p.deadlineAt,
      templateCriteria: template,
      previous: previous?.body,
      editRequest,
    });
    const version = await saveTermsVersion(promiseId, body, {
      source: "architect",
      authorId: null,
      changeSummary:
        draft.changeSummary ??
        (editRequest ? `Revised: ${editRequest.slice(0, 200)}` : "First draft by the Contract Architect"),
      notes: {
        questionsForClient: draft.questionsForClient,
        manipulationNotes: draft.manipulationNotes ?? null,
        requestedBy: authorId ?? null,
      },
    });
    await db
      .update(promises)
      .set({ termsStatus: "idle", termsError: null })
      .where(eq(promises.id, promiseId));
    await enqueue("critique.run", { termsVersionId: version.id });
    return version;
  } catch (e) {
    log.error({ promise_id: promiseId, err: (e as Error).message }, "contract generation failed");
    await db
      .update(promises)
      .set({ termsStatus: "failed", termsError: (e as Error).message.slice(0, 500) })
      .where(eq(promises.id, promiseId));
    throw e;
  }
}

export async function runCritique(termsVersionId: string) {
  const db = getDb();
  const [tv] = await db.select().from(termsVersions).where(eq(termsVersions.id, termsVersionId));
  if (!tv || tv.critique) return tv?.critique ?? null;
  const [p] = await db.select().from(promises).where(eq(promises.id, tv.promiseId));
  const critique = await critiqueContract({
    termsVersionId,
    brief: p!.sourceBrief ?? p!.title,
    body: tv.body,
  });
  await db.update(termsVersions).set({ critique }).where(eq(termsVersions.id, termsVersionId));
  return critique;
}

/** Insert a new immutable, hashed terms version and point the promise at it. */
async function saveTermsVersion(
  promiseId: string,
  body: TermsBody,
  meta: {
    source: "architect" | "manual" | "template";
    authorId: string | null;
    changeSummary: string;
    notes?: unknown;
  },
) {
  const db = getDb();
  const parsed = TermsBodySchema.parse(body);
  const bodyHash = hashTerms(parsed);
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(promises).where(eq(promises.id, promiseId)).for("update");
    const [last] = await tx
      .select({ version: termsVersions.version })
      .from(termsVersions)
      .where(eq(termsVersions.promiseId, promiseId))
      .orderBy(desc(termsVersions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const [tv] = await tx
      .insert(termsVersions)
      .values({
        promiseId,
        version,
        body: parsed,
        bodyHash,
        authorId: meta.authorId,
        source: meta.source,
        changeSummary: meta.changeSummary,
        notes: meta.notes ?? null,
      })
      .returning();
    await tx
      .update(promises)
      .set({ currentTermsVersionId: tv!.id, title: parsed.title })
      .where(eq(promises.id, promiseId));
    await appendLedgerEvent(tx, {
      promiseId,
      type: "terms.versioned",
      actor: meta.authorId ? `user:${meta.authorId}` : "system",
      payload: { version, bodyHash, source: meta.source, changeSummary: meta.changeSummary },
    });
    if (p!.state === "NEGOTIATING") {
      await applyPromiseEvent(tx, {
        promiseId,
        event: "TERMS_EDITED",
        actor: { kind: "system" },
        ledgerType: "terms.edited",
        payload: { version },
      });
    }
    return tv!;
  });
}

/* ─────────────── Edits (SPEC §16 POST /api/promises/:id/terms) ─────────────── */

const EditInput = z.union([
  z.object({ instruction: z.string().trim().min(3).max(2000) }),
  z.object({ body: TermsBodySchema, changeSummary: z.string().trim().max(300).optional() }),
]);

export async function proposeTermsEdit(actor: Actor, promiseId: string, raw: unknown) {
  const input = EditInput.parse(raw);
  const p = await loadPromise(promiseId);
  assertParty(actor, p);
  if (!["DRAFT", "NEGOTIATING"].includes(p.state))
    throw new AppError("CONFLICT", "Terms can only change before both sides sign");
  if (p.termsStatus === "generating")
    throw new AppError("CONFLICT", "The contract builder is still working. Try again in a moment.");

  if ("instruction" in input) {
    await requestTermsGeneration(promiseId, { editRequest: input.instruction, authorId: actorUserId(actor) });
    return { status: "generating" as const };
  }
  const budget = p.budgetMinor ?? undefined;
  const issues = validateTerms(input.body, budget);
  if (issues.length) throw new AppError("VALIDATION_FAILED", "The terms have problems", issues);
  const tv = await saveTermsVersion(promiseId, input.body, {
    source: "manual",
    authorId: actorUserId(actor),
    changeSummary: input.changeSummary || "Edited by hand",
  });
  if (anthropicConfigured()) await enqueue("critique.run", { termsVersionId: tv.id });
  await notifyOtherParty(
    actor,
    p,
    "terms_ready",
    "Terms were updated",
    `The terms for "${p.title}" changed (version ${tv.version}). Review and sign.`,
  );
  return { status: "saved" as const, version: tv.version, bodyHash: tv.bodyHash };
}

/** One-click "Apply suggestion" from the Critic. Keeps weights summing to 100 by rescaling the others. */
export async function applyCritiqueSuggestion(actor: Actor, promiseId: string, issueIndex: number) {
  const p = await loadPromise(promiseId);
  assertParty(actor, p);
  const [tv] = await getDb()
    .select()
    .from(termsVersions)
    .where(eq(termsVersions.id, p.currentTermsVersionId ?? ""));
  if (!tv) throw new AppError("NOT_FOUND", "No terms yet");
  const critique = tv.critique as CriteriaCritique | null;
  const issue = critique?.issues[issueIndex];
  if (!issue?.suggestedCriterion) throw new AppError("NOT_FOUND", "That suggestion is not available");
  const body = structuredClone(tv.body);
  const m = body.milestones[issue.milestoneIndex];
  if (!m) throw new AppError("NOT_FOUND", "Milestone not found");
  const suggestion = issue.suggestedCriterion as Criterion;
  const idx = issue.criterionId ? m.criteria.findIndex((c) => c.id === issue.criterionId) : -1;
  if (idx >= 0) m.criteria[idx] = { ...suggestion, id: m.criteria[idx]!.id };
  else {
    if (m.criteria.length >= 8) throw new AppError("CONFLICT", "A milestone can have at most 8 criteria");
    const nextId = `c${Math.max(0, ...m.criteria.map((c) => Number(c.id.slice(1)))) + 1}`;
    m.criteria.push({ ...suggestion, id: nextId });
  }
  m.criteria = rebalanceWeights(
    m.criteria,
    idx >= 0 ? m.criteria[idx]!.id : m.criteria[m.criteria.length - 1]!.id,
  );
  return proposeTermsEdit(actor, promiseId, {
    body,
    changeSummary: `Applied Critic suggestion (${issue.code}${issue.criterionId ? ` on ${issue.criterionId}` : ""})`,
  });
}

/** Keep `fixedId`'s weight; scale the others (largest remainder) so the total is exactly 100. */
export function rebalanceWeights(list: Criterion[], fixedId: string): Criterion[] {
  const fixed = list.find((c) => c.id === fixedId)!;
  const fixedWeight = Math.min(fixed.weight, 100 - (list.length - 1));
  const others = list.filter((c) => c.id !== fixedId);
  const remaining = 100 - fixedWeight;
  const sum = others.reduce((s, c) => s + c.weight, 0) || others.length;
  const raw = others.map((c) => ({
    id: c.id,
    exact: ((sum === others.length && others.every((o) => o.weight === 0) ? 1 : c.weight) / sum) * remaining,
  }));
  const floored = raw.map((r) => ({ ...r, w: Math.max(1, Math.floor(r.exact)) }));
  let diff = remaining - floored.reduce((s, r) => s + r.w, 0);
  const order = [...floored].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; diff !== 0 && order.length; i = (i + 1) % order.length) {
    const r = order[i]!;
    if (diff > 0) {
      r.w++;
      diff--;
    } else if (r.w > 1) {
      r.w--;
      diff++;
    }
  }
  const weights = new Map(floored.map((r) => [r.id, r.w]));
  return list.map((c) =>
    c.id === fixedId ? { ...c, weight: fixedWeight } : { ...c, weight: weights.get(c.id)! },
  );
}

/* ─────────────── Invite (SPEC §16 POST /api/promises/:id/invite) ─────────────── */

export async function inviteWorker(actor: Actor, promiseId: string, rawEmail: string) {
  const email = z.string().trim().toLowerCase().email().parse(rawEmail);
  const p = await loadPromise(promiseId);
  assertParty(actor, p, "client");
  if (!["DRAFT", "NEGOTIATING"].includes(p.state))
    throw new AppError("CONFLICT", "The worker can only change before signing");
  const clientEmail = (
    await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, p.clientUserId ?? ""))
  )[0]?.email;
  if (clientEmail === email) throw new AppError("VALIDATION_FAILED", "You can't hire yourself");
  await attachWorkerByEmail(promiseId, email);
  return loadPromise(promiseId);
}

async function attachWorkerByEmail(promiseId: string, email: string) {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  const worker =
    existing ??
    (
      await db
        .insert(users)
        .values({ email, displayName: email.split("@")[0]! })
        .onConflictDoNothing()
        .returning()
    )[0] ??
    (await db.select().from(users).where(eq(users.email, email)))[0]!;
  await db.transaction(async (tx) => {
    // Changing the worker invalidates any signature on the current version.
    const [p] = await tx.select().from(promises).where(eq(promises.id, promiseId)).for("update");
    await tx
      .update(promises)
      .set({ workerUserId: worker.id, inviteEmail: email })
      .where(eq(promises.id, promiseId));
    if (p!.currentTermsVersionId) {
      await tx
        .delete(signatures)
        .where(and(eq(signatures.termsVersionId, p!.currentTermsVersionId), eq(signatures.party, "worker")));
    }
    await appendLedgerEvent(tx, {
      promiseId,
      type: "promise.invited",
      actor: "system",
      payload: { workerUserId: worker.id },
    });
    if (p!.state === "DRAFT")
      await applyPromiseEvent(tx, {
        promiseId,
        event: "INVITE_SENT",
        actor: { kind: "system" },
        ledgerType: "promise.negotiating",
      });
  });
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  await notify({
    userId: worker.id,
    template: "job_offer",
    title: `New job offer: ${p!.title}`,
    body: `You've been invited to "${p!.title}" on Ahadi. Review the acceptance criteria and sign if you agree. You'll see "Funds secured" before you start.`,
    link: `/promises/${promiseId}`,
    promiseId,
  });
}

/* ─────────────── Sign (SPEC §16 POST /api/promises/:id/sign) ─────────────── */

export async function signTerms(actor: Actor, promiseId: string, bodyHash: string) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(promises).where(eq(promises.id, promiseId)).for("update");
    if (!p) throw new AppError("NOT_FOUND", "Promise not found");
    const party = assertParty(actor, p);
    if (p.state !== "NEGOTIATING")
      throw new AppError(
        "CONFLICT",
        p.state === "DRAFT" ? "Invite the worker before signing" : `Can't sign in state ${p.state}`,
      );
    if (!p.workerUserId && !p.workerAgentId) throw new AppError("CONFLICT", "Invite a worker first");
    if (p.termsStatus === "generating")
      throw new AppError("CONFLICT", "A new version is being drafted. Wait for it before signing.");
    const [tv] = await tx
      .select()
      .from(termsVersions)
      .where(eq(termsVersions.id, p.currentTermsVersionId ?? ""));
    if (!tv) throw new AppError("CONFLICT", "No terms to sign");
    if (tv.bodyHash !== bodyHash)
      throw new AppError(
        "TERMS_HASH_MISMATCH",
        "These terms changed since you opened them. Review the latest version.",
        { current: tv.bodyHash, given: bodyHash },
      );
    if (hashTerms(tv.body) !== tv.bodyHash)
      throw new AppError("INTERNAL", "Stored terms fail their own hash");
    const issues = validateTerms(tv.body, p.budgetMinor ?? undefined);
    if (issues.length) throw new AppError("VALIDATION_FAILED", "Fix the terms before signing", issues);

    const [sig] = await tx
      .insert(signatures)
      .values({
        termsVersionId: tv.id,
        party,
        signerUserId: actor.kind === "user" ? actor.user.id : null,
        signerAgentId: actor.kind === "agent" ? actor.agent.id : null,
        bodyHash,
      })
      .onConflictDoNothing()
      .returning();
    if (sig)
      await appendLedgerEvent(tx, {
        promiseId,
        type: "terms.signed",
        actor: actorTag(actor),
        payload: { party, version: tv.version, bodyHash },
      });

    const sigs = await tx.select().from(signatures).where(eq(signatures.termsVersionId, tv.id));
    const both =
      sigs.some((s) => s.party === "client" && s.bodyHash === tv.bodyHash) &&
      sigs.some((s) => s.party === "worker" && s.bodyHash === tv.bodyHash);
    if (!both) return { agreed: false, party, p };
    await materializeMilestones(tx, p.id, tv.body);
    await applyPromiseEvent(tx, {
      promiseId,
      event: "BOTH_SIGNED",
      actor,
      ledgerType: "promise.agreed",
      payload: { version: tv.version, bodyHash },
    });
    return { agreed: true, party, p };
  });

  const other = result.party === "client" ? result.p.workerUserId : result.p.clientUserId;
  if (result.agreed) {
    for (const uid of [result.p.clientUserId, result.p.workerUserId]) {
      await notify({
        userId: uid,
        template: "terms_signed",
        title: `Terms agreed: ${result.p.title}`,
        body: "Both sides signed the same terms. The client can now secure funds through PayPal.",
        link: `/promises/${promiseId}`,
        promiseId,
      });
    }
  } else {
    await notify({
      userId: other,
      template: "terms_signed",
      title: `${result.party === "client" ? "The client" : "The worker"} signed`,
      body: `"${result.p.title}" is waiting for your signature.`,
      link: `/promises/${promiseId}`,
      promiseId,
    });
  }
  return { agreed: result.agreed };
}

/** Milestones and criteria are created from the signed version (and only then). */
async function materializeMilestones(tx: Tx, promiseId: string, body: TermsBody) {
  await tx.execute(
    sql`delete from ${criteria} where milestone_id in (select id from ${milestones} where promise_id = ${promiseId} and state = 'UNFUNDED')`,
  );
  await tx
    .delete(milestones)
    .where(and(eq(milestones.promiseId, promiseId), eq(milestones.state, "UNFUNDED")));
  const env = getEnv();
  for (const m of body.milestones) {
    const [row] = await tx
      .insert(milestones)
      .values({
        promiseId,
        position: m.position,
        title: m.title,
        amountMinor: m.amountMinor,
        dueAt: m.dueInDays ? new Date(Date.now() + m.dueInDays * 86_400_000) : null,
        maxAttempts: env.MAX_ATTEMPTS,
      })
      .returning();
    await tx
      .insert(criteria)
      .values(
        m.criteria.map((c) => ({
          milestoneId: row!.id,
          key: c.id,
          spec: c,
          weight: c.weight,
          required: c.required,
        })),
      );
  }
}

/* ─────────────── Cancel ─────────────── */

export async function cancelPromise(actor: Actor, promiseId: string, reason: string) {
  const p = await loadPromise(promiseId);
  assertParty(actor, p);
  if (!["DRAFT", "NEGOTIATING", "AGREED"].includes(p.state))
    throw new AppError("CONFLICT", "Funded promises can't be cancelled; use mediation instead");
  await getDb().transaction((tx) =>
    applyPromiseEvent(tx, {
      promiseId,
      event: "CANCELLED",
      actor,
      ledgerType: "promise.cancelled",
      payload: { reason: reason.slice(0, 500) },
    }),
  );
  await notifyOtherParty(
    actor,
    p,
    "generic",
    `Promise cancelled: ${p.title}`,
    reason || "The other party cancelled this promise before funding.",
  );
}

async function loadPromise(id: string) {
  const [p] = await getDb().select().from(promises).where(eq(promises.id, id));
  if (!p) throw new AppError("NOT_FOUND", "Promise not found");
  return p;
}

async function notifyOtherParty(
  actor: Actor,
  p: typeof promises.$inferSelect,
  template: Parameters<typeof notify>[0]["template"],
  title: string,
  body: string,
) {
  const role = partyRole(actor, p);
  const other = role === "client" ? p.workerUserId : role === "worker" ? p.clientUserId : null;
  await notify({ userId: other, template, title, body, link: `/promises/${p.id}`, promiseId: p.id });
}

export async function listTermsVersions(promiseId: string) {
  return getDb()
    .select({
      id: termsVersions.id,
      version: termsVersions.version,
      bodyHash: termsVersions.bodyHash,
      source: termsVersions.source,
      changeSummary: termsVersions.changeSummary,
      createdAt: termsVersions.createdAt,
    })
    .from(termsVersions)
    .where(eq(termsVersions.promiseId, promiseId))
    .orderBy(desc(termsVersions.version));
}
