import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AppError,
  computeProposal,
  type ComputedProposal,
  type Criterion,
  type MachineCheck,
} from "@ahadi/core";
import { getEnv, getPolicy } from "@ahadi/core/env";
import {
  anthropicConfigured,
  classifyInjection,
  reviewVerdicts,
  verifyCriteria,
  type CriterionVerdict,
  type InjectionReport,
  type VerifierEvidence,
} from "@ahadi/agents";
import {
  artifacts,
  criteria as criteriaTable,
  criterionResults,
  getDb,
  milestones,
  promises,
  proposals,
  riskFlags,
  submissions,
  termsVersions,
  verifications,
  type CriterionRow,
  type Verification,
} from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { enqueue } from "@ahadi/queue";
import {
  collectCode,
  collectData,
  collectDesign,
  collectWeb,
  collectWriting,
  evaluateCheck,
  highestSeverity,
  scanTargets,
  stripFindings,
  validateAgainstSchema,
  type CheckContext,
  type CollectorResult,
} from "@ahadi/verifiers";
import { actorTag, assertParty, isAdmin, partyRole, SYSTEM, type Actor } from "./actor";
import { MAX_FILE_BYTES, MAX_SUBMISSION_BYTES, sha256, storeArtifact } from "./artifacts";
import { getLiveFunding } from "./funding";
import { log } from "./log";
import { notify } from "./notify";
import { publishProposal } from "./proposals";
import { applyMilestoneEvent, lockMilestone } from "./transitions";

/* ─────────────── Submit (SPEC §16 POST /api/milestones/:id/submissions) ─────────────── */

export const SubmissionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    url: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//.test(u), "Must be an http(s) URL"),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal("repo"),
    repoUrl: z.string().url(),
    commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i, "Use the full or short commit SHA"),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(20).max(200_000),
    note: z.string().max(2000).optional(),
  }),
  z.object({ kind: z.literal("files"), note: z.string().max(2000).optional() }),
]);
export type SubmissionInput = z.infer<typeof SubmissionInput>;

export interface UploadedFile {
  name: string;
  mime: string;
  data: Buffer;
}

export async function submitWork(
  actor: Actor,
  milestoneId: string,
  raw: unknown,
  files: UploadedFile[] = [],
) {
  const input = SubmissionInput.parse(raw);
  if (input.kind === "files") {
    if (files.length === 0) throw new AppError("VALIDATION_FAILED", "Attach at least one file");
    if (files.length > 10) throw new AppError("VALIDATION_FAILED", "At most 10 files");
    if (files.some((f) => f.data.length > MAX_FILE_BYTES))
      throw new AppError("VALIDATION_FAILED", "Each file must be 10 MB or smaller");
    if (files.reduce((s, f) => s + f.data.length, 0) > MAX_SUBMISSION_BYTES)
      throw new AppError("VALIDATION_FAILED", "Files must total 25 MB or less");
  }
  const db = getDb();
  const sub = await db.transaction(async (tx) => {
    const { milestone, promise } = await lockMilestone(tx, milestoneId);
    assertParty(actor, promise, "worker");
    if (milestone.state !== "FUNDED")
      throw new AppError(
        "CONFLICT",
        milestone.state === "UNFUNDED"
          ? "The client hasn't secured funds yet. Don't start until you see \"Funds secured\"."
          : `Can't submit while the milestone is ${milestone.state.toLowerCase()}`,
      );
    if (milestone.attemptsUsed >= milestone.maxAttempts)
      throw new AppError("CONFLICT", `All ${milestone.maxAttempts} attempts are used`);
    if (!(await getLiveFunding(tx, milestone.id)))
      throw new AppError("CONFLICT", "The PayPal hold is no longer valid; the client must fund again");
    const attempt = milestone.attemptsUsed + 1;
    const [s] = await tx
      .insert(submissions)
      .values({
        milestoneId,
        attempt,
        kind: input.kind,
        url: input.kind === "url" ? input.url : null,
        repoUrl: input.kind === "repo" ? input.repoUrl : null,
        commitSha: input.kind === "repo" ? input.commitSha.toLowerCase() : null,
        text: input.kind === "text" ? input.text : null,
        note: input.note ?? null,
        submittedByUserId: actor.kind === "user" ? actor.user.id : null,
        submittedByAgentId: actor.kind === "agent" ? actor.agent.id : null,
      })
      .returning();
    const hashes: { name: string; sha256: string; bytes: number }[] = [];
    if (input.kind === "text")
      hashes.push({ name: "text", sha256: sha256(Buffer.from(input.text)), bytes: input.text.length });
    for (const f of files) {
      const a = await storeArtifact(tx, {
        submissionId: s!.id,
        role: "deliverable",
        kind: "file",
        mime: f.mime || "application/octet-stream",
        data: f.data,
        meta: { fileName: f.name },
      });
      hashes.push({ name: f.name, sha256: a.sha256, bytes: a.bytes });
    }
    await applyMilestoneEvent(tx, {
      milestoneId,
      event: "WORK_SUBMITTED",
      actor,
      patch: { attemptsUsed: attempt },
      payload: {
        submissionId: s!.id,
        attempt,
        kind: input.kind,
        url: s!.url,
        repoUrl: s!.repoUrl,
        commitSha: s!.commitSha,
        artifactHashes: hashes,
      },
    });
    return { s: s!, promise };
  });
  await enqueue("verification.run", { submissionId: sub.s.id });
  await notify({
    userId: sub.promise.clientUserId,
    template: "work_submitted",
    title: `Work submitted: ${sub.promise.title}`,
    body: `Attempt ${sub.s.attempt} is being verified against your signed criteria. You can watch it live.`,
    link: `/promises/${sub.promise.id}/verify?milestone=${milestoneId}`,
    promiseId: sub.promise.id,
  });
  return sub.s;
}

/* ─────────────── Pipeline (SPEC §8.3) ─────────────── */

type Stage =
  "fetching" | "scanning" | "collecting" | "checking" | "judging" | "reviewing" | "settling" | "done";

async function setStage(id: string, stage: Stage, extra: Partial<Verification> = {}) {
  await getDb()
    .update(verifications)
    .set({ stage, ...extra })
    .where(eq(verifications.id, id));
}

export async function runVerification(
  submissionId: string,
): Promise<{ status: string; verificationId: string }> {
  const db = getDb();
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
  if (!sub) throw new AppError("NOT_FOUND", "Submission not found");
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, sub.milestoneId));
  const [promise] = await db.select().from(promises).where(eq(promises.id, ms!.promiseId));
  const existing = (
    await db
      .select()
      .from(verifications)
      .where(eq(verifications.submissionId, submissionId))
      .orderBy(desc(verifications.startedAt))
  )[0];
  if (existing && existing.status !== "RUNNING" && existing.status !== "FAILED")
    return { status: existing.status, verificationId: existing.id };

  let verification = existing;
  if (!verification) {
    verification = await db.transaction(async (tx) => {
      const [v] = await tx
        .insert(verifications)
        .values({
          submissionId,
          termsVersionId: promise!.currentTermsVersionId!,
          status: "RUNNING",
          stage: "fetching",
        })
        .returning();
      if (ms!.state === "SUBMITTED")
        await applyMilestoneEvent(tx, {
          milestoneId: ms!.id,
          event: "VERIFICATION_STARTED",
          actor: SYSTEM,
          payload: { verificationId: v!.id, attempt: sub.attempt },
        });
      return v!;
    });
  } else {
    // Retry after a crash: wipe partial results and start the stages again.
    await db.delete(criterionResults).where(eq(criterionResults.verificationId, verification.id));
    await db
      .update(verifications)
      .set({ status: "RUNNING", stage: "fetching", error: null })
      .where(eq(verifications.id, verification.id));
  }
  const vid = verification.id;
  const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MIN ?? 15) * 60_000;

  try {
    const outcome = await Promise.race([
      pipeline(vid, sub, ms!, promise!),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`Verification exceeded ${timeoutMs / 60000} minutes`)), timeoutMs),
      ),
    ]);
    return { status: outcome, verificationId: vid };
  } catch (e) {
    log.error({ verification_id: vid, err: (e as Error).message }, "verification failed");
    await db
      .update(verifications)
      .set({ status: "FAILED", error: (e as Error).message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(verifications.id, vid));
    // Route to a human instead of leaving the milestone stuck in VERIFYING.
    await db.transaction(async (tx) => {
      const { milestone } = await lockMilestone(tx, ms!.id);
      if (milestone.state === "VERIFYING")
        await applyMilestoneEvent(tx, {
          milestoneId: ms!.id,
          event: "NEEDS_HUMAN_REVIEW",
          actor: SYSTEM,
          payload: {
            verificationId: vid,
            reason: "pipeline_error",
            error: (e as Error).message.slice(0, 300),
          },
        });
    });
    await db.update(verifications).set({ status: "NEEDS_HUMAN" }).where(eq(verifications.id, vid));
    await notify({
      userId: promise!.clientUserId,
      template: "needs_review",
      title: `Verification needs a human: ${promise!.title}`,
      body: "Automated verification could not finish. An Ahadi reviewer (or you, for taste-based criteria) will decide.",
      link: `/promises/${promise!.id}/verify?milestone=${ms!.id}`,
      promiseId: promise!.id,
    });
    return { status: "NEEDS_HUMAN", verificationId: vid };
  }
}

interface ResultRow {
  criterion: CriterionRow;
  outcome: "pass" | "partial" | "fail" | "undetermined";
  credit: number;
  confidence: number;
  decidedBy: "machine" | "agent" | "human";
  reasoning: string;
  howToFix?: string | null;
  evidenceArtifactIds: string[];
}

async function pipeline(
  vid: string,
  sub: typeof submissions.$inferSelect,
  ms: typeof milestones.$inferSelect,
  promise: typeof promises.$inferSelect,
): Promise<string> {
  const db = getDb();
  const crit = await db
    .select()
    .from(criteriaTable)
    .where(eq(criteriaTable.milestoneId, ms.id))
    .orderBy(asc(criteriaTable.key));
  const specs = crit.map((c) => c.spec);
  const checks = specs
    .filter((c) => c.method === "automated" && c.check)
    .map((c) => c.check!) as MachineCheck[];

  // 1. Fetch deliverable and collect evidence for the category.
  await setStage(vid, "collecting");
  const deliverables = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.submissionId, sub.id), eq(artifacts.role, "deliverable")));
  const collected = await collect(promise.category, sub, deliverables, specs, checks);

  // Store evidence artifacts (hashed) and map collector keys → artifact ids.
  const keyToId = new Map<string, string>();
  for (const a of collected.artifacts) {
    const row = await storeArtifact(db, {
      verificationId: vid,
      submissionId: sub.id,
      role: "evidence",
      kind: a.kind,
      mime: a.mime,
      data: a.data,
      meta: { key: a.key, label: a.label, ...(a.meta ?? {}) },
    });
    keyToId.set(a.key, row.id);
  }
  for (const d of deliverables) keyToId.set(`deliverable_${d.id}`, d.id);

  // 2. Injection defence (SPEC §10.2): deterministic scan → Sentinel → strip-and-compare.
  await setStage(vid, "scanning");
  const findings = scanTargets(collected.scanTargets, collected.renderedHidden);
  let report: InjectionReport | null = null;
  if (findings.length && anthropicConfigured()) {
    report = await classifyInjection({
      verificationId: vid,
      findings: findings.slice(0, 40),
      excerpts: collected.untrustedBlocks
        .map((b) => b.text)
        .join("\n")
        .slice(0, 8000),
    }).catch((e) => {
      log.warn(
        { verification_id: vid, err: (e as Error).message },
        "sentinel failed; using deterministic severity",
      );
      return null;
    });
  }
  const injectionFlagged = report ? report.overall === "injection" : highestSeverity(findings) === "high";
  const injectionReport = { findings, sentinel: report, decidedBy: report ? "agent" : "scanner" };
  const flagged = new Set(
    report
      ? report.findings.filter((f) => f.classification !== "benign").map((f) => f.findingId)
      : findings.filter((f) => f.severity !== "low").map((f) => f.id),
  );
  const strip = findings.filter((f) => flagged.has(f.id));
  const untrustedBlocks = collected.untrustedBlocks.map((b) => ({
    ...b,
    text: stripFindings(b.text, strip),
  }));
  await db
    .update(verifications)
    .set({
      injectionFlagged,
      injectionReport,
      evidence: {
        summary: collected.summary,
        warnings: collected.warnings,
        artifactKeys: Object.fromEntries(keyToId),
      },
    })
    .where(eq(verifications.id, vid));
  if (injectionFlagged) {
    await db.transaction(async (tx) => {
      await tx.insert(riskFlags).values({
        subjectType: "submission",
        subjectId: sub.id,
        code: "INJECTION",
        severity: "high",
        detail: {
          verificationId: vid,
          summary: report?.summaryForClient ?? "Hidden instructions aimed at the AI verifier were found.",
          findings: strip.slice(0, 10).map((f) => ({ location: f.location, text: f.text.slice(0, 200) })),
        },
      });
      await appendLedgerEvent(tx, {
        promiseId: promise.id,
        type: "injection.flagged",
        actor: "system",
        payload: {
          milestoneId: ms.id,
          verificationId: vid,
          findings: strip.length,
          summary: report?.summaryForClient ?? null,
        },
      });
    });
  }

  // 3. Machine checks decide automated criteria.
  await setStage(vid, "checking");
  const ctx = checkContext(promise.category, collected, deliverables);
  const results: ResultRow[] = [];
  for (const c of crit) {
    if (c.spec.method !== "automated" || !c.spec.check) continue;
    const r = evaluateCheck(c.spec.check, ctx);
    const row: ResultRow = {
      criterion: c,
      outcome: r.outcome,
      credit: r.credit,
      confidence: r.confidence,
      decidedBy: "machine",
      reasoning: r.reasoning,
      evidenceArtifactIds: r.evidenceKeys.map((k) => keyToId.get(k)).filter(Boolean) as string[],
    };
    results.push(row);
    await saveResult(vid, row);
  }

  // 4. Verifier agent decides ai_judgment criteria (with borderline re-runs and a Reviewer).
  await setStage(vid, "judging");
  const aiCrit = crit.filter((c) => c.spec.method === "ai_judgment");
  const evidence = await buildEvidence(collected, keyToId, untrustedBlocks, results);
  if (aiCrit.length) {
    if (!anthropicConfigured()) {
      for (const c of aiCrit) {
        const row: ResultRow = {
          criterion: c,
          outcome: "undetermined",
          credit: 0,
          confidence: 0,
          decidedBy: "agent",
          reasoning:
            "AI verification is not configured (an AI provider key (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)). A human decides this criterion.",
          evidenceArtifactIds: [],
        };
        results.push(row);
        await saveResult(vid, row);
      }
    } else {
      const decided = await judgeWithConsistency(
        vid,
        promise.category,
        aiCrit.map((c) => c.spec),
        evidence,
      );
      await setStage(vid, "reviewing");
      const reviewed = await maybeReview(
        vid,
        aiCrit.map((c) => c.spec),
        decided,
        evidence,
        ms.amountMinor,
      );
      for (const c of aiCrit) {
        const v = reviewed.find((x) => x.criterionId === c.key)!;
        const row: ResultRow = {
          criterion: c,
          outcome: v.outcome,
          credit: v.credit,
          confidence: v.confidence,
          decidedBy: "agent",
          reasoning: v.reasoning,
          howToFix: v.howToFix ?? null,
          evidenceArtifactIds: v.evidenceArtifactIds
            .map((k) => (k === "evidence-summary" ? keyToId.get(collectedReportKey(collected)) : k))
            .filter((k): k is string => Boolean(k) && [...keyToId.values()].includes(k!)),
        };
        results.push(row);
        await saveResult(vid, row);
      }
    }
  }

  // 5. Human-method criteria wait for the client (SPEC §4.4).
  for (const c of crit.filter((x) => x.spec.method === "human")) {
    const row: ResultRow = {
      criterion: c,
      outcome: "undetermined",
      credit: 0,
      confidence: 0,
      decidedBy: "human",
      reasoning: "This criterion is decided by the client.",
      evidenceArtifactIds: [],
    };
    results.push(row);
    await saveResult(vid, row);
  }

  await setStage(vid, "settling");
  return settleFromResults(vid, ms.id, promise, crit, injectionFlagged);
}

function collectedReportKey(c: CollectorResult): string {
  return c.artifacts.find((a) => a.kind === "report")?.key ?? c.artifacts[0]?.key ?? "";
}

async function collect(
  category: string,
  sub: typeof submissions.$inferSelect,
  deliverables: (typeof artifacts.$inferSelect)[],
  specs: Criterion[],
  checks: MachineCheck[],
): Promise<CollectorResult> {
  const files = deliverables.map((d) => ({
    key: d.id,
    fileName: String((d.meta as { fileName?: string })?.fileName ?? d.id),
    mime: d.mime,
    data: d.data!,
  }));
  switch (category) {
    case "web":
      if (!sub.url) throw new AppError("VALIDATION_FAILED", "Web deliverables are submitted as a URL");
      return collectWeb(sub.url, checks);
    case "writing":
    case "research": {
      const textFile = files.find(
        (f) => /text|markdown|json/.test(f.mime) || /\.(md|txt)$/i.test(f.fileName),
      );
      return collectWriting({ text: sub.text ?? textFile?.data.toString("utf8") ?? null, url: sub.url });
    }
    case "code":
      if (!sub.repoUrl || !sub.commitSha)
        throw new AppError("VALIDATION_FAILED", "Code deliverables need a repository URL and commit SHA");
      return collectCode({
        repoUrl: sub.repoUrl,
        commitSha: sub.commitSha,
        criteria: specs,
        checks,
        hiddenSuites: await hiddenSuites(checks),
      });
    case "design":
      return collectDesign(files);
    case "data": {
      const f = files.find((x) => /csv|json|text/.test(x.mime) || /\.(csv|json)$/i.test(x.fileName));
      if (!f) throw new AppError("VALIDATION_FAILED", "Data deliverables are a CSV or JSON file");
      return collectData({ raw: f.data.toString("utf8"), fileName: f.fileName });
    }
    default:
      throw new AppError("VALIDATION_FAILED", `No verifier for category ${category}`);
  }
}

/** Client-provided hidden test suites are stored as artifacts at contract time (hiddenSuiteId = artifact id). */
async function hiddenSuites(checks: MachineCheck[]) {
  const ids = checks
    .filter((c) => c.kind === "test_suite" && c.hiddenSuiteId)
    .map((c) => (c as { hiddenSuiteId: string }).hiddenSuiteId);
  const out: { path: string; content: Buffer }[] = [];
  for (const id of ids) {
    const [a] = await getDb().select().from(artifacts).where(eq(artifacts.id, id));
    if (a?.data)
      out.push({
        path: String((a.meta as { path?: string })?.path ?? `ahadi_hidden_${id.slice(0, 8)}.test.js`),
        content: a.data,
      });
  }
  return out;
}

function checkContext(
  category: string,
  c: CollectorResult,
  deliverables: (typeof artifacts.$inferSelect)[],
): CheckContext {
  const s = c.summary as never;
  const ctx: CheckContext = {
    files: deliverables.map((d) => ({ fileName: String((d.meta as { fileName?: string })?.fileName ?? "") })),
  };
  if (category === "web") ctx.web = s;
  if (category === "writing" || category === "research") ctx.writing = s;
  if (category === "code") ctx.code = s;
  if (category === "design") ctx.design = s;
  if (category === "data") {
    ctx.data = s;
    const raw = deliverables.find((d) => /csv|json/.test(d.mime))?.data?.toString("utf8");
    if (raw) {
      ctx.dataValidate = (schema) => {
        try {
          return validateAgainstSchema(JSON.parse(raw), schema);
        } catch {
          return { valid: false, errors: ["Dataset is not JSON; json_schema applies to JSON datasets"] };
        }
      };
    }
  }
  return ctx;
}

async function buildEvidence(
  c: CollectorResult,
  keyToId: Map<string, string>,
  untrustedBlocks: CollectorResult["untrustedBlocks"],
  machine: ResultRow[],
): Promise<VerifierEvidence> {
  const images = c.imageKeys
    .map((k) => c.artifacts.find((a) => a.key === k))
    .filter((a): a is NonNullable<typeof a> => Boolean(a) && a!.data.length < 4.5 * 1024 * 1024)
    .slice(0, 6)
    .map((a) => ({
      artifactId: keyToId.get(a.key)!,
      label: a.label,
      mediaType: (a.mime === "image/jpeg" ? "image/jpeg" : "image/png") as "image/jpeg" | "image/png",
      base64: a.data.toString("base64"),
    }));
  return {
    summary: trimSummary(c.summary),
    images,
    untrustedBlocks,
    machineResults: machine.map((m) => ({
      criterion: m.criterion.key,
      outcome: m.outcome,
      reasoning: m.reasoning,
    })),
    artifactIds: [...keyToId.values()],
  };
}

/** Keep the summary compact for the model: drop visible text (it's in untrusted blocks) and long lists. */
function trimSummary(s: Record<string, unknown>): unknown {
  return JSON.parse(
    JSON.stringify(s, (k, v) => {
      if (k === "visibleText" || k === "text") return undefined;
      if (Array.isArray(v) && v.length > 40) return [...v.slice(0, 40), `… ${v.length - 40} more`];
      if (typeof v === "string" && v.length > 2000) return `${v.slice(0, 2000)}…`;
      return v;
    }),
  );
}

/** SPEC §8.2: borderline (< 0.85) criteria are re-run up to 2 more times; majority wins, disagreement lowers confidence. */
async function judgeWithConsistency(
  vid: string,
  category: string,
  specs: Criterion[],
  evidence: VerifierEvidence,
): Promise<CriterionVerdict[]> {
  const first = await verifyCriteria({ verificationId: vid, category, criteria: specs, evidence });
  const borderline = first.verdicts.filter((v) => v.confidence < 0.85).map((v) => v.criterionId);
  if (!borderline.length) return first.verdicts;
  const subset = specs.filter((s) => borderline.includes(s.id));
  const reruns = await Promise.all(
    [0, 1].map(() =>
      verifyCriteria({ verificationId: vid, category, criteria: subset, evidence }).catch(() => null),
    ),
  );
  return first.verdicts.map((v) => {
    if (!borderline.includes(v.criterionId)) return v;
    const runs = [
      v,
      ...reruns
        .map((r) => r?.verdicts.find((x) => x.criterionId === v.criterionId))
        .filter((x): x is CriterionVerdict => Boolean(x)),
    ];
    const tally = new Map<string, CriterionVerdict[]>();
    for (const r of runs) tally.set(r.outcome, [...(tally.get(r.outcome) ?? []), r]);
    const [, winners] = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
    const unanimous = winners.length === runs.length;
    const pick = winners.sort((a, b) => b.confidence - a.confidence)[0]!;
    const avgCredit = winners.reduce((s, r) => s + r.credit, 0) / winners.length;
    return {
      ...pick,
      credit: avgCredit,
      confidence: unanimous ? Math.min(...winners.map((r) => r.confidence)) : Math.min(pick.confidence, 0.6),
    };
  });
}

/** SPEC §8.1: Verdict Reviewer for confidence in [0.6, 0.85) or a high-value partial release. */
async function maybeReview(
  vid: string,
  specs: Criterion[],
  verdicts: CriterionVerdict[],
  evidence: VerifierEvidence,
  amountMinor: number,
): Promise<CriterionVerdict[]> {
  const policy = getPolicy(getEnv());
  const borderline = verdicts
    .filter((v) => v.confidence >= 0.6 && v.confidence < 0.85)
    .map((v) => v.criterionId);
  const highValuePartial =
    amountMinor > policy.humanConfirmAboveMinor &&
    verdicts.some((v) => v.outcome === "partial" || v.outcome === "fail");
  const toReview = highValuePartial ? verdicts.map((v) => v.criterionId) : borderline;
  if (!toReview.length) return verdicts;
  try {
    const review = await reviewVerdicts({
      verificationId: vid,
      criteria: specs.filter((s) => toReview.includes(s.id)),
      previous: verdicts.filter((v) => toReview.includes(v.criterionId)),
      evidence,
    });
    return verdicts.map((v) => review.verdicts.find((r) => r.criterionId === v.criterionId) ?? v);
  } catch (e) {
    log.warn(
      { verification_id: vid, err: (e as Error).message },
      "verdict reviewer failed; keeping first verdicts",
    );
    return verdicts;
  }
}

async function saveResult(vid: string, r: ResultRow) {
  await getDb()
    .insert(criterionResults)
    .values({
      verificationId: vid,
      criterionId: r.criterion.id,
      outcome: r.outcome,
      credit: Math.round(r.credit * 100) / 100,
      confidence: Math.round(r.confidence * 100) / 100,
      decidedBy: r.decidedBy,
      reasoning: r.reasoning.slice(0, 2000),
      howToFix: r.howToFix ?? null,
      evidenceArtifactIds: r.evidenceArtifactIds,
    })
    .onConflictDoUpdate({
      target: [criterionResults.verificationId, criterionResults.criterionId],
      set: {
        outcome: r.outcome,
        credit: Math.round(r.credit * 100) / 100,
        confidence: Math.round(r.confidence * 100) / 100,
        decidedBy: r.decidedBy,
        reasoning: r.reasoning.slice(0, 2000),
        howToFix: r.howToFix ?? null,
        evidenceArtifactIds: r.evidenceArtifactIds,
      },
    });
}

/** Run the settlement engine on the stored results; publish or route to a human. */
export async function settleFromResults(
  vid: string,
  milestoneId: string,
  promise: typeof promises.$inferSelect,
  crit: CriterionRow[],
  injectionFlagged: boolean,
): Promise<string> {
  const db = getDb();
  const rows = await db.select().from(criterionResults).where(eq(criterionResults.verificationId, vid));
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  const computed = computeProposal({
    milestoneAmountMinor: ms!.amountMinor,
    criteria: crit.map((c) => ({
      id: c.key,
      weight: c.weight,
      required: c.required,
      partialCredit: c.spec.partialCredit,
    })),
    results: crit.map((c) => {
      const r = rows.find((x) => x.criterionId === c.id)!;
      return { criterionId: c.key, outcome: r.outcome, credit: r.credit, confidence: r.confidence };
    }),
    injectionFlagged,
    policy: getPolicy(getEnv()),
  });
  const summary = summarize(computed, crit, rows);

  if (computed.kind === "blocked") {
    await db.transaction(async (tx) => {
      await tx
        .update(verifications)
        .set({ status: "NEEDS_HUMAN", stage: "done", summary, finishedAt: new Date() })
        .where(eq(verifications.id, vid));
      const { milestone } = await lockMilestone(tx, milestoneId);
      if (milestone.state === "VERIFYING") {
        await applyMilestoneEvent(tx, {
          milestoneId,
          event: "NEEDS_HUMAN_REVIEW",
          actor: SYSTEM,
          payload: {
            verificationId: vid,
            blockedReason: computed.blockedReason,
            lowConfidence: computed.lowConfidenceCriteria,
            results: verdictPayload(computed),
          },
        });
      }
    });
    const why =
      computed.blockedReason === "injection"
        ? "the deliverable contains hidden instructions aimed at the AI verifier"
        : computed.blockedReason === "low_confidence"
          ? "the verifier wasn't confident enough on some criteria"
          : "some criteria need a human decision";
    await notify({
      userId: promise.clientUserId,
      template: "needs_review",
      title: `Your decision is needed: ${promise.title}`,
      body: `No money moves yet: ${why}.`,
      link: `/promises/${promise.id}/verify?milestone=${milestoneId}`,
      promiseId: promise.id,
    });
    await notify({
      userId: promise.workerUserId,
      template: "needs_review",
      title: `Verification is waiting for a reviewer: ${promise.title}`,
      body: `No money moves yet: ${why}.`,
      link: `/promises/${promise.id}/verify?milestone=${milestoneId}`,
      promiseId: promise.id,
    });
    return "NEEDS_HUMAN";
  }

  await db.transaction(async (tx) => {
    await tx
      .update(verifications)
      .set({ status: "COMPLETE", stage: "done", summary, finishedAt: new Date() })
      .where(eq(verifications.id, vid));
    const { milestone } = await lockMilestone(tx, milestoneId);
    const event = milestone.state === "NEEDS_HUMAN" ? "HUMAN_REVIEWED" : "PROPOSAL_COMPUTED";
    await applyMilestoneEvent(tx, {
      milestoneId,
      event,
      actor: SYSTEM,
      payload: { verificationId: vid, results: verdictPayload(computed), evidenceHashes: true },
    });
  });
  await publishProposal(vid, computed);
  return "COMPLETE";
}

function verdictPayload(p: ComputedProposal) {
  return p.breakdown.map((c) => ({
    criterion: c.id,
    outcome: c.outcome,
    creditPct: c.creditPct,
    confidence: c.confidence,
  }));
}

function summarize(
  p: ComputedProposal,
  crit: CriterionRow[],
  rows: (typeof criterionResults.$inferSelect)[],
): string {
  const passed = rows.filter((r) => r.outcome === "pass").length;
  const title = (key: string) => crit.find((c) => c.key === key)?.spec.title ?? key;
  const failing = p.breakdown.filter((b) => b.creditPct < 100).map((b) => `${title(b.id)} (${b.outcome})`);
  return `${passed} of ${crit.length} criteria passed.${failing.length ? ` Not fully met: ${failing.join("; ")}.` : ""}${p.blockedReason ? ` Blocked: ${p.blockedReason}.` : ""}`;
}

/* ─────────────── Human review of blocked verdicts (NEEDS_HUMAN → VERDICT_READY) ─────────────── */

export const HumanReviewInput = z.object({
  decisions: z
    .array(
      z.object({
        criterionKey: z.string(),
        outcome: z.enum(["pass", "partial", "fail"]),
        credit: z.number().min(0).max(1).optional(),
        reasoning: z.string().trim().min(3).max(1000),
      }),
    )
    .min(1),
  clearInjection: z.object({ note: z.string().trim().min(5).max(1000) }).optional(),
});

export async function reviewVerification(actor: Actor, milestoneId: string, raw: unknown) {
  const input = HumanReviewInput.parse(raw);
  const db = getDb();
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!ms) throw new AppError("NOT_FOUND", "Milestone not found");
  const [promise] = await db.select().from(promises).where(eq(promises.id, ms.promiseId));
  const admin = isAdmin(actor);
  const role = partyRole(actor, promise!);
  if (!admin && role !== "client")
    throw new AppError("FORBIDDEN", "Only the client (for human criteria) or an Ahadi reviewer can decide");
  if (ms.state !== "NEEDS_HUMAN") throw new AppError("CONFLICT", "Nothing is waiting for review");
  const v = await latestVerification(ms.id);
  if (!v) throw new AppError("NOT_FOUND", "No verification");
  const crit = await db.select().from(criteriaTable).where(eq(criteriaTable.milestoneId, ms.id));

  for (const d of input.decisions) {
    const c = crit.find((x) => x.key === d.criterionKey);
    if (!c) throw new AppError("VALIDATION_FAILED", `Unknown criterion ${d.criterionKey}`);
    if (!admin && c.spec.method !== "human")
      throw new AppError(
        "FORBIDDEN",
        `Only an Ahadi reviewer can decide ${c.key} (it isn't a taste-based criterion)`,
      );
    if (d.outcome === "partial" && !c.spec.partialCredit)
      throw new AppError("VALIDATION_FAILED", `${c.key} does not allow partial credit`);
    await saveResult(v.id, {
      criterion: c,
      outcome: d.outcome,
      credit:
        d.outcome === "pass" ? 1 : d.outcome === "fail" ? 0 : Math.min(0.95, Math.max(0.05, d.credit ?? 0.5)),
      confidence: 1,
      decidedBy: "human",
      reasoning: d.reasoning,
      evidenceArtifactIds: [],
    });
  }
  let injection = v.injectionFlagged;
  if (input.clearInjection) {
    if (!admin) throw new AppError("FORBIDDEN", "Only an Ahadi reviewer can clear an injection flag");
    injection = false;
    await db.update(verifications).set({ injectionFlagged: false }).where(eq(verifications.id, v.id));
  }
  await db.transaction((tx) =>
    appendLedgerEvent(tx, {
      promiseId: promise!.id,
      type: "verification.human_reviewed",
      actor: actorTag(actor),
      payload: {
        milestoneId,
        verificationId: v.id,
        decisions: input.decisions.map((d) => ({ criterion: d.criterionKey, outcome: d.outcome })),
        injectionCleared: Boolean(input.clearInjection),
        note: input.clearInjection?.note ?? null,
      },
    }),
  );
  const status = await settleFromResults(v.id, ms.id, promise!, crit, injection);
  return { status };
}

export async function latestVerification(milestoneId: string) {
  const [row] = await getDb()
    .select({ v: verifications })
    .from(verifications)
    .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
    .where(eq(submissions.milestoneId, milestoneId))
    .orderBy(desc(verifications.startedAt))
    .limit(1);
  return row?.v;
}

/** Live view (SSE + page): verification, per-criterion results and the active proposal. */
export async function getVerificationView(actor: Actor, milestoneId: string) {
  const db = getDb();
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!ms) throw new AppError("NOT_FOUND", "Milestone not found");
  const [promise] = await db.select().from(promises).where(eq(promises.id, ms.promiseId));
  if (!isAdmin(actor) && !partyRole(actor, promise!)) throw new AppError("NOT_FOUND", "Milestone not found");
  const v = await latestVerification(milestoneId);
  const crit = await db
    .select()
    .from(criteriaTable)
    .where(eq(criteriaTable.milestoneId, milestoneId))
    .orderBy(asc(criteriaTable.key));
  const results = v
    ? await db.select().from(criterionResults).where(eq(criterionResults.verificationId, v.id))
    : [];
  const [proposal] = v
    ? await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.verificationId, v.id), isNull(proposals.supersededAt)))
    : [];
  const [sub] = v ? await db.select().from(submissions).where(eq(submissions.id, v.submissionId)) : [];
  const evidence = v
    ? await db
        .select({
          id: artifacts.id,
          kind: artifacts.kind,
          mime: artifacts.mime,
          bytes: artifacts.bytes,
          sha256: artifacts.sha256,
          meta: artifacts.meta,
        })
        .from(artifacts)
        .where(eq(artifacts.verificationId, v.id))
    : [];
  const [terms] = promise!.currentTermsVersionId
    ? await db
        .select({ version: termsVersions.version, bodyHash: termsVersions.bodyHash })
        .from(termsVersions)
        .where(eq(termsVersions.id, promise!.currentTermsVersionId))
    : [];
  return {
    promise: promise!,
    milestone: ms,
    role: partyRole(actor, promise!),
    isAdmin: isAdmin(actor),
    terms,
    submission: sub ?? null,
    verification: v ? { ...v, evidence: undefined, injectionReport: v.injectionReport } : null,
    warnings: ((v?.evidence as { warnings?: string[] } | null)?.warnings ?? []) as string[],
    criteria: crit.map((c) => ({
      id: c.id,
      key: c.key,
      spec: c.spec,
      weight: c.weight,
      required: c.required,
      result: results.find((r) => r.criterionId === c.id) ?? null,
    })),
    evidence,
    proposal: proposal ?? null,
  };
}
export type VerificationView = Awaited<ReturnType<typeof getVerificationView>>;
