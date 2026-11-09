import { AppError, invariant } from "./errors";
import { applyBps, assertMinor } from "./money";

/**
 * Settlement engine (SPEC §7). Pure, synchronous, no I/O and no model calls.
 * Every number a user ever sees about a release comes from here.
 */

export type Outcome = "pass" | "partial" | "fail" | "undetermined";
export type BlockedReason = "injection" | "undetermined" | "low_confidence";
export type ZeroReason = "required_failed";

export interface SettlementCriterion {
  id: string;
  weight: number;
  required: boolean;
  partialCredit: boolean;
}

export interface SettlementResult {
  criterionId: string;
  outcome: Outcome;
  credit: number;
  confidence: number;
}

export interface SettlementPolicy {
  minAutoConfidence: number;
  platformFeeBps: number;
  humanConfirmAboveMinor: number;
}

export interface SettlementInput {
  milestoneAmountMinor: number;
  criteria: SettlementCriterion[];
  results: SettlementResult[];
  injectionFlagged: boolean;
  policy: SettlementPolicy;
}

export interface CreditedCriterion extends SettlementCriterion {
  outcome: Outcome;
  /** Normalised credit in whole percent (0, 5, 10 … 100). */
  creditPct: number;
  confidence: number;
  /** Basis points of the milestone this criterion contributes. */
  contributionBps: number;
}

export type ProposalKind = "release" | "zero" | "blocked";

export interface ComputedProposal {
  kind: ProposalKind;
  releaseBps: number;
  captureMinor: number;
  platformFeeMinor: number;
  /** Captured minus platform fee, before PayPal's own fee (final figure comes from the capture). */
  workerEstimateMinor: number;
  requiresHumanConfirm: boolean;
  blockedReason: BlockedReason | ZeroReason | null;
  /** Criteria below the confidence gate (only when blockedReason = low_confidence). */
  lowConfidenceCriteria: string[];
  breakdown: CreditedCriterion[];
}

const roundToStep = (value: number, step: number) => Math.round(value / step) * step;

/** Normalise a model's credit into whole percent according to SPEC §7.2 step 1. */
export function normaliseCreditPct(outcome: Outcome, credit: number, partialCredit: boolean): number {
  if (outcome === "pass") return 100;
  if (outcome === "partial" && partialCredit) {
    if (!Number.isFinite(credit)) return 5;
    const rounded = roundToStep(credit, 0.05);
    const clamped = Math.min(0.95, Math.max(0.05, rounded));
    return Math.round(clamped * 100);
  }
  return 0;
}

export function computeProposal(i: SettlementInput): ComputedProposal {
  assertMinor(i.milestoneAmountMinor, "milestoneAmountMinor");
  if (i.milestoneAmountMinor <= 0)
    throw new AppError("VALIDATION_FAILED", "Milestone amount must be positive");
  if (i.criteria.length === 0) throw new AppError("VALIDATION_FAILED", "Milestone has no criteria");

  const weightSum = i.criteria.reduce((s, c) => s + c.weight, 0);
  if (weightSum !== 100)
    throw new AppError("VALIDATION_FAILED", `Criterion weights sum to ${weightSum}, not 100`);
  for (const c of i.criteria) {
    if (!Number.isInteger(c.weight) || c.weight < 0)
      throw new AppError("VALIDATION_FAILED", `Bad weight on ${c.id}`);
  }

  const byId = new Map<string, SettlementResult>();
  for (const r of i.results) {
    if (byId.has(r.criterionId))
      throw new AppError("VALIDATION_FAILED", `Duplicate result for criterion ${r.criterionId}`);
    byId.set(r.criterionId, r);
  }
  const criterionIds = new Set(i.criteria.map((c) => c.id));
  for (const r of i.results) {
    if (!criterionIds.has(r.criterionId))
      throw new AppError("VALIDATION_FAILED", `Result for unknown criterion ${r.criterionId}`);
  }

  // 1. Normalise credit.
  const breakdown: CreditedCriterion[] = i.criteria.map((c) => {
    const r = byId.get(c.id);
    if (!r) throw new AppError("VALIDATION_FAILED", `Missing result for criterion ${c.id}`);
    const creditPct = normaliseCreditPct(r.outcome, r.credit, c.partialCredit);
    return {
      ...c,
      outcome: r.outcome,
      creditPct,
      confidence: r.confidence,
      contributionBps: c.weight * creditPct,
    };
  });

  const base = { breakdown, lowConfidenceCriteria: [] as string[] };
  const blocked = (reason: BlockedReason, lowConfidenceCriteria: string[] = []): ComputedProposal => ({
    ...base,
    kind: "blocked",
    releaseBps: 0,
    captureMinor: 0,
    platformFeeMinor: 0,
    workerEstimateMinor: 0,
    requiresHumanConfirm: false,
    blockedReason: reason,
    lowConfidenceCriteria,
  });

  // 2. Blocking conditions — order matters.
  if (i.injectionFlagged) return blocked("injection");
  if (breakdown.some((c) => c.outcome === "undetermined")) return blocked("undetermined");
  const low = breakdown.filter((c) => c.confidence < i.policy.minAutoConfidence).map((c) => c.id);
  if (low.length > 0) return blocked("low_confidence", low);
  if (breakdown.some((c) => c.required && c.creditPct < 100)) {
    return {
      ...base,
      kind: "zero",
      releaseBps: 0,
      captureMinor: 0,
      platformFeeMinor: 0,
      workerEstimateMinor: 0,
      requiresHumanConfirm: false,
      blockedReason: "required_failed",
    };
  }

  // 3. Weighted release in basis points (integer math: weight × whole-percent credit).
  const releaseBps = breakdown.reduce((s, c) => s + c.contributionBps, 0);
  invariant(releaseBps >= 0 && releaseBps <= 10000, "releaseBps in range");

  // 4. Amounts — floor to protect the payer.
  const captureMinor = applyBps(i.milestoneAmountMinor, releaseBps);
  const platformFeeMinor = applyBps(captureMinor, i.policy.platformFeeBps);
  invariant(captureMinor <= i.milestoneAmountMinor, "never capture more than authorized");
  invariant(platformFeeMinor <= captureMinor, "fee never exceeds capture");

  return {
    ...base,
    kind: releaseBps === 0 ? "zero" : "release",
    releaseBps,
    captureMinor,
    platformFeeMinor,
    workerEstimateMinor: captureMinor - platformFeeMinor,
    requiresHumanConfirm: captureMinor > i.policy.humanConfirmAboveMinor,
    blockedReason: null,
  };
}

/* ───────────────────────────── Payout split (SPEC §6.6) ───────────────────────────── */

export interface SplitRecipient {
  paypalEmail: string;
  shareBps: number;
  userId?: string | null;
}

export interface PayoutLine {
  paypalEmail: string;
  userId: string | null;
  amountMinor: number;
}

export interface PayoutPlan {
  netMinor: number;
  platformFeeMinor: number;
  distributableMinor: number;
  lines: PayoutLine[];
}

/**
 * net           = capture net_amount (after PayPal's fee)
 * platform_fee  = floor(captured × feeBps / 10000)
 * distributable = net − platform_fee
 * per recipient = floor(distributable × share / 10000); remainder cents → first recipient
 */
export function computePayoutPlan(args: {
  capturedMinor: number;
  netMinor: number;
  platformFeeBps: number;
  recipients: SplitRecipient[];
}): PayoutPlan {
  const { capturedMinor, netMinor, platformFeeBps, recipients } = args;
  assertMinor(capturedMinor, "capturedMinor");
  assertMinor(netMinor, "netMinor");
  if (netMinor > capturedMinor) throw new AppError("VALIDATION_FAILED", "Net cannot exceed captured amount");
  if (recipients.length === 0) throw new AppError("VALIDATION_FAILED", "No payout recipients");
  const shareSum = recipients.reduce((s, r) => s + r.shareBps, 0);
  if (shareSum !== 10000)
    throw new AppError("VALIDATION_FAILED", `Split shares sum to ${shareSum} bps, not 10000`);

  const platformFeeMinor = applyBps(capturedMinor, platformFeeBps);
  const distributableMinor = Math.max(0, netMinor - platformFeeMinor);
  const lines = recipients.map((r) => ({
    paypalEmail: r.paypalEmail,
    userId: r.userId ?? null,
    amountMinor: applyBps(distributableMinor, r.shareBps),
  }));
  const remainder = distributableMinor - lines.reduce((s, l) => s + l.amountMinor, 0);
  invariant(remainder >= 0 && remainder < recipients.length, "split remainder is a few cents at most");
  lines[0]!.amountMinor += remainder;
  return { netMinor, platformFeeMinor, distributableMinor, lines };
}

/** "What lands in M-Pesa" estimate (SPEC §6.6). Clearly an estimate, not a quote. */
export function estimateMpesaKes(
  distributableMinor: number,
  kesPerUsd: number,
  withdrawalFeeRate = 0.03,
): number {
  return Math.floor((distributableMinor / 100) * kesPerUsd * (1 - withdrawalFeeRate));
}
