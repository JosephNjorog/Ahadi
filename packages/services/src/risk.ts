import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { anthropicConfigured, assessRisk } from "@ahadi/agents";
import { getEnv } from "@ahadi/core/env";
import { formatMoney } from "@ahadi/core";
import {
  fundings,
  getDb,
  milestones,
  promises,
  riskFlags,
  settlements,
  proposals,
  verifications,
  submissions,
  users,
} from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { log } from "./log";

/** SPEC §10.2 step 8 + AGENT_PROMPTS §9: rules first (always enforced), then the Risk Analyst. */

export interface RiskSignal {
  code: string;
  severity: "low" | "medium" | "high";
  detail: string;
  holdPayout?: boolean;
}

export async function collectSignals(
  promiseId: string,
): Promise<{ signals: RiskSignal[]; summary: string; clientHistory: string; workerHistory: string }> {
  const db = getDb();
  const env = getEnv();
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  if (!p) return { signals: [], summary: "", clientHistory: "", workerHistory: "" };
  const ids = [p.clientUserId, p.workerUserId].filter(Boolean) as string[];
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const client = people.find((u) => u.id === p.clientUserId);
  const worker = people.find((u) => u.id === p.workerUserId);
  const signals: RiskSignal[] = [];

  if (client && worker) {
    const norm = (e: string | null | undefined) =>
      e
        ?.trim()
        .toLowerCase()
        .replace(/\+[^@]*@/, "@");
    if (norm(client.email) === norm(worker.email))
      signals.push({
        code: "SELF_DEALING",
        severity: "high",
        detail: "Client and worker use the same email address",
        holdPayout: true,
      });
    if (client.paypalEmail && norm(client.paypalEmail) === norm(worker.paypalEmail))
      signals.push({
        code: "SELF_DEALING",
        severity: "high",
        detail: "Client and worker share a PayPal email",
        holdPayout: true,
      });
    if (client.phoneE164 && client.phoneE164 === worker.phoneE164)
      signals.push({
        code: "SELF_DEALING",
        severity: "high",
        detail: "Client and worker share a phone number",
        holdPayout: true,
      });
    const ageH = (u: typeof client) => (Date.now() - u.createdAt.getTime()) / 3600_000;
    if (ageH(client) < 24 && ageH(worker) < 24)
      signals.push({
        code: "NEW_ACCOUNTS",
        severity: "low",
        detail: "Both accounts are less than a day old",
      });
  }

  // Payer on PayPal == worker's payout email (money round-trip).
  const ms = await db.select().from(milestones).where(eq(milestones.promiseId, promiseId));
  const fs = ms.length
    ? await db
        .select()
        .from(fundings)
        .where(
          inArray(
            fundings.milestoneId,
            ms.map((m) => m.id),
          ),
        )
    : [];
  for (const f of fs) {
    if (
      f.payerEmail &&
      worker?.paypalEmail &&
      f.payerEmail.toLowerCase() === worker.paypalEmail.toLowerCase()
    )
      signals.push({
        code: "SELF_DEALING",
        severity: "high",
        detail: "The PayPal account that funded the work is the worker's payout account",
        holdPayout: true,
      });
  }

  // Velocity and fast full-release cycles between the same pair.
  if (client && worker) {
    const since = new Date(Date.now() - 30 * 86400_000);
    const pair = await db
      .select({ id: promises.id, createdAt: promises.createdAt })
      .from(promises)
      .where(
        and(
          gte(promises.createdAt, since),
          or(
            and(eq(promises.clientUserId, client.id), eq(promises.workerUserId, worker.id)),
            and(eq(promises.clientUserId, worker.id), eq(promises.workerUserId, client.id)),
          ),
        ),
      );
    if (pair.length >= 5)
      signals.push({
        code: "VELOCITY",
        severity: "medium",
        detail: `${pair.length} promises between these two people in 30 days`,
      });
    const reverse =
      pair.length &&
      (
        await db
          .select({ id: promises.id })
          .from(promises)
          .where(and(eq(promises.clientUserId, worker.id), eq(promises.workerUserId, client.id)))
          .limit(1)
      ).length;
    if (reverse)
      signals.push({
        code: "CIRCULAR",
        severity: "medium",
        detail: "These two people have also hired each other in the opposite direction",
      });
    const fast = await db
      .select({
        createdAt: settlements.createdAt,
        releaseBps: proposals.releaseBps,
        fundedAt: fundings.createdAt,
      })
      .from(settlements)
      .innerJoin(proposals, eq(proposals.id, settlements.proposalId))
      .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
      .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
      .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
      .innerJoin(fundings, eq(fundings.milestoneId, milestones.id))
      .innerJoin(promises, eq(promises.id, milestones.promiseId))
      .where(
        and(
          eq(promises.clientUserId, client.id),
          eq(promises.workerUserId, worker.id),
          gte(settlements.createdAt, since),
        ),
      );
    const quickFull = fast.filter(
      (x) => x.releaseBps === 10000 && x.createdAt.getTime() - x.fundedAt.getTime() < 3600_000,
    ).length;
    if (quickFull >= 3)
      signals.push({
        code: "FAST_CYCLES",
        severity: "medium",
        detail: `${quickFull} full releases within an hour of funding between this pair`,
      });
  }

  const threshold = env.HUMAN_CONFIRM_ABOVE_USD * 100;
  const total = ms.reduce((s, m) => s + m.amountMinor, 0);
  if (total > threshold * 0.9 && total <= threshold)
    signals.push({
      code: "THRESHOLD",
      severity: "low",
      detail: `Amount ${formatMoney(total)} sits just under the human-confirmation threshold`,
    });

  const history = async (uid: string | null | undefined, role: "client" | "worker") => {
    if (!uid) return "none";
    const rows = await db
      .select({ title: promises.title, state: promises.state, createdAt: promises.createdAt })
      .from(promises)
      .where(role === "client" ? eq(promises.clientUserId, uid) : eq(promises.workerUserId, uid))
      .orderBy(desc(promises.createdAt))
      .limit(10);
    return (
      rows.map((r) => `${r.createdAt.toISOString().slice(0, 10)} ${r.state} "${r.title}"`).join("\n") ||
      "no previous promises"
    );
  };
  return {
    signals,
    summary: `${p.title} (${p.category}), ${formatMoney(total || (p.budgetMinor ?? 0), p.currency)}. Brief: ${(p.sourceBrief ?? "").slice(0, 1500)}`,
    clientHistory: await history(p.clientUserId, "client"),
    workerHistory: await history(p.workerUserId, "worker"),
  };
}

export async function scoreRisk(promiseId: string, trigger: "created" | "funded" | "payout") {
  const db = getDb();
  const { signals, summary, clientHistory, workerHistory } = await collectSignals(promiseId);
  const ruleHold = signals.some((s) => s.holdPayout);
  let assessment: Awaited<ReturnType<typeof assessRisk>> | null = null;
  if (signals.length && anthropicConfigured()) {
    assessment = await assessRisk({
      promiseId,
      signals,
      promiseSummary: summary,
      clientHistory,
      workerHistory,
    }).catch((e) => {
      log.warn({ promise_id: promiseId, err: (e as Error).message }, "risk analyst failed; rules only");
      return null;
    });
  }
  // The Risk Analyst can only escalate a hold when a rule found something of
  // at least medium severity; low-severity signals alone (e.g. new accounts)
  // are recorded for review but never pause money on a model's say-so.
  const aiMayHold = signals.some((s) => s.severity !== "low");
  const hold = ruleHold || (aiMayHold && assessment?.action === "hold_payout");
  const existing = await db
    .select()
    .from(riskFlags)
    .where(
      and(
        eq(riskFlags.subjectType, "promise"),
        eq(riskFlags.subjectId, promiseId),
        isNull(riskFlags.resolvedAt),
      ),
    );
  for (const s of signals) {
    if (existing.some((e) => e.code === s.code && (e.detail as { detail?: string }).detail === s.detail))
      continue;
    await db.insert(riskFlags).values({
      subjectType: "promise",
      subjectId: promiseId,
      code: s.code,
      severity: s.severity,
      detail: { detail: s.detail, trigger, assessment: assessment?.summaryForAdmin ?? null },
    });
  }
  if (hold && !existing.some((e) => e.code === "HOLD_PAYOUT")) {
    await db.insert(riskFlags).values({
      subjectType: "promise",
      subjectId: promiseId,
      code: "HOLD_PAYOUT",
      severity: "high",
      detail: {
        reasons: signals.filter((s) => s.holdPayout || s.severity === "high").map((s) => s.detail),
        assessment,
        trigger,
      },
    });
    await db.transaction((tx) =>
      appendLedgerEvent(tx, {
        promiseId,
        type: "risk.hold_payout",
        actor: "system",
        payload: { trigger, codes: signals.map((s) => s.code) },
      }),
    );
  }
  return {
    signals: signals.length,
    hold,
    level: assessment?.level ?? (ruleHold ? "high" : signals.length ? "medium" : "low"),
  };
}

/** High-severity flags pause payouts until an admin resolves them (SPEC §10.2). */
export async function payoutOnHold(promiseId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: riskFlags.id })
    .from(riskFlags)
    .where(
      and(
        eq(riskFlags.subjectType, "promise"),
        eq(riskFlags.subjectId, promiseId),
        eq(riskFlags.code, "HOLD_PAYOUT"),
        isNull(riskFlags.resolvedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listRiskFlags(limit = 100) {
  return getDb().select().from(riskFlags).orderBy(desc(riskFlags.createdAt)).limit(limit);
}

export async function resolveRiskFlag(flagId: string, adminId: string, note: string) {
  const db = getDb();
  const [f] = await db
    .update(riskFlags)
    .set({ resolvedAt: new Date() })
    .where(eq(riskFlags.id, flagId))
    .returning();
  if (f?.subjectType === "promise") {
    await db.transaction((tx) =>
      appendLedgerEvent(tx, {
        promiseId: f.subjectId,
        type: "risk.resolved",
        actor: `admin:${adminId}`,
        payload: { flagId, code: f.code, note: note.slice(0, 500) },
      }),
    );
  }
  return f;
}
