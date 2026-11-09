import { IllegalTransitionError } from "./errors";

/* ───────────────────────────── Milestone (SPEC §4.3) ───────────────────────────── */

export const MILESTONE_STATES = [
  "UNFUNDED",
  "FUNDING",
  "FUNDED",
  "SUBMITTED",
  "VERIFYING",
  "NEEDS_HUMAN",
  "VERDICT_READY",
  "OBJECTION_WINDOW",
  "MEDIATING",
  "SETTLING",
  "SETTLED",
  "SETTLEMENT_FAILED",
  "REFUNDING",
  "VOIDED",
  "ESCALATED",
] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const MILESTONE_EVENTS = [
  "ORDER_CREATED",
  "AUTHORIZATION_CREATED",
  "FUNDING_CANCELLED",
  "AUTHORIZATION_EXPIRED",
  "WORK_SUBMITTED",
  "DEADLINE_MISSED",
  "VERIFICATION_STARTED",
  "PROPOSAL_COMPUTED",
  "NEEDS_HUMAN_REVIEW",
  "HUMAN_REVIEWED",
  "PROPOSAL_PUBLISHED",
  "SETTLEMENT_APPROVED",
  "RESUBMIT_CHOSEN",
  "OBJECTION_RAISED",
  "MEDIATION_ACCEPTED",
  "MEDIATION_RESUBMIT",
  "MEDIATION_ESCALATED",
  "SETTLEMENT_COMPLETED",
  "SETTLEMENT_FAILED",
  "SETTLEMENT_RETRIED",
  "AUTHORIZATION_VOIDED",
] as const;
export type MilestoneEvent = (typeof MILESTONE_EVENTS)[number];

/**
 * Transition table. Matches the SPEC §4.3 diagram, plus three transitions the spec
 * describes in prose:
 *  - FUNDED --AUTHORIZATION_EXPIRED--> UNFUNDED   (§6.4 "Expired → milestone UNFUNDED")
 *  - MEDIATING --MEDIATION_RESUBMIT--> FUNDED     (AGENT_PROMPTS §7 resolution "resubmit")
 *  - SETTLING --AUTHORIZATION_VOIDED--> VOIDED    (§4.3 "A release of 0% … executes a void")
 */
const MILESTONE_TABLE: Record<MilestoneState, Partial<Record<MilestoneEvent, MilestoneState>>> = {
  UNFUNDED: { ORDER_CREATED: "FUNDING" },
  FUNDING: {
    ORDER_CREATED: "FUNDING", // buyer retried checkout: a new order replaces the old one
    AUTHORIZATION_CREATED: "FUNDED",
    FUNDING_CANCELLED: "UNFUNDED",
  },
  FUNDED: {
    WORK_SUBMITTED: "SUBMITTED",
    DEADLINE_MISSED: "REFUNDING",
    AUTHORIZATION_EXPIRED: "UNFUNDED",
  },
  SUBMITTED: { VERIFICATION_STARTED: "VERIFYING" },
  VERIFYING: { PROPOSAL_COMPUTED: "VERDICT_READY", NEEDS_HUMAN_REVIEW: "NEEDS_HUMAN" },
  NEEDS_HUMAN: { HUMAN_REVIEWED: "VERDICT_READY" },
  VERDICT_READY: { PROPOSAL_PUBLISHED: "OBJECTION_WINDOW" },
  OBJECTION_WINDOW: {
    SETTLEMENT_APPROVED: "SETTLING",
    RESUBMIT_CHOSEN: "FUNDED",
    OBJECTION_RAISED: "MEDIATING",
  },
  MEDIATING: {
    MEDIATION_ACCEPTED: "SETTLING",
    MEDIATION_RESUBMIT: "FUNDED",
    MEDIATION_ESCALATED: "ESCALATED",
  },
  SETTLING: {
    SETTLEMENT_COMPLETED: "SETTLED",
    SETTLEMENT_FAILED: "SETTLEMENT_FAILED",
    AUTHORIZATION_VOIDED: "VOIDED",
  },
  SETTLEMENT_FAILED: { SETTLEMENT_RETRIED: "SETTLING" },
  REFUNDING: { AUTHORIZATION_VOIDED: "VOIDED" },
  SETTLED: {},
  VOIDED: {},
  ESCALATED: {},
};

export const TERMINAL_MILESTONE_STATES: ReadonlySet<MilestoneState> = new Set([
  "SETTLED",
  "VOIDED",
  "ESCALATED",
]);

/** States in which PayPal is holding (authorized, uncaptured) money for the milestone. */
export const FUNDS_HELD_STATES: ReadonlySet<MilestoneState> = new Set([
  "FUNDED",
  "SUBMITTED",
  "VERIFYING",
  "NEEDS_HUMAN",
  "VERDICT_READY",
  "OBJECTION_WINDOW",
  "MEDIATING",
  "SETTLING",
  "SETTLEMENT_FAILED",
  "REFUNDING",
]);

export function nextMilestoneState(from: MilestoneState, event: MilestoneEvent): MilestoneState | null {
  return MILESTONE_TABLE[from]?.[event] ?? null;
}

export function canTransitionMilestone(from: MilestoneState, event: MilestoneEvent): boolean {
  return nextMilestoneState(from, event) !== null;
}

/** The only way milestone state changes. Throws IllegalTransitionError. */
export function transitionMilestone(from: MilestoneState, event: MilestoneEvent): MilestoneState {
  const to = nextMilestoneState(from, event);
  if (!to) throw new IllegalTransitionError("milestone", from, event);
  return to;
}

export function milestoneEventsFrom(from: MilestoneState): MilestoneEvent[] {
  return Object.keys(MILESTONE_TABLE[from]) as MilestoneEvent[];
}

/* ───────────────────────────── Promise (SPEC §4.2) ───────────────────────────── */

export const PROMISE_STATES = [
  "DRAFT",
  "NEGOTIATING",
  "AGREED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PromiseState = (typeof PROMISE_STATES)[number];

export const PROMISE_EVENTS = [
  "INVITE_SENT",
  "TERMS_EDITED",
  "BOTH_SIGNED",
  "CANCELLED",
  "FIRST_MILESTONE_FUNDED",
  "ALL_MILESTONES_TERMINAL",
  "MEDIATION_OPENED",
  "MEDIATION_RESOLVED",
] as const;
export type PromiseEvent = (typeof PROMISE_EVENTS)[number];

const PROMISE_TABLE: Record<PromiseState, Partial<Record<PromiseEvent, PromiseState>>> = {
  DRAFT: { INVITE_SENT: "NEGOTIATING", CANCELLED: "CANCELLED" },
  NEGOTIATING: { TERMS_EDITED: "NEGOTIATING", BOTH_SIGNED: "AGREED", CANCELLED: "CANCELLED" },
  // AGREED → CANCELLED: nothing has been funded yet, so either side may still walk away.
  AGREED: { FIRST_MILESTONE_FUNDED: "ACTIVE", CANCELLED: "CANCELLED" },
  ACTIVE: { ALL_MILESTONES_TERMINAL: "COMPLETED", MEDIATION_OPENED: "DISPUTED" },
  DISPUTED: { MEDIATION_RESOLVED: "ACTIVE" },
  COMPLETED: {},
  CANCELLED: {},
};

export function nextPromiseState(from: PromiseState, event: PromiseEvent): PromiseState | null {
  return PROMISE_TABLE[from]?.[event] ?? null;
}

export function transitionPromise(from: PromiseState, event: PromiseEvent): PromiseState {
  const to = nextPromiseState(from, event);
  if (!to) throw new IllegalTransitionError("promise", from, event);
  return to;
}

/** Ledger event type recorded for each milestone event. */
export const MILESTONE_EVENT_LEDGER_TYPE: Record<MilestoneEvent, string> = {
  ORDER_CREATED: "funding.order_created",
  AUTHORIZATION_CREATED: "funding.secured",
  FUNDING_CANCELLED: "funding.cancelled",
  AUTHORIZATION_EXPIRED: "funding.expired",
  WORK_SUBMITTED: "submission.received",
  DEADLINE_MISSED: "milestone.deadline_missed",
  VERIFICATION_STARTED: "verification.started",
  PROPOSAL_COMPUTED: "verification.completed",
  NEEDS_HUMAN_REVIEW: "verification.needs_human",
  HUMAN_REVIEWED: "verification.human_reviewed",
  PROPOSAL_PUBLISHED: "proposal.published",
  SETTLEMENT_APPROVED: "decision.recorded",
  RESUBMIT_CHOSEN: "decision.recorded",
  OBJECTION_RAISED: "mediation.opened",
  MEDIATION_ACCEPTED: "mediation.resolved",
  MEDIATION_RESUBMIT: "mediation.resolved",
  MEDIATION_ESCALATED: "mediation.escalated",
  SETTLEMENT_COMPLETED: "milestone.settled",
  SETTLEMENT_FAILED: "settlement.failed",
  SETTLEMENT_RETRIED: "settlement.retried",
  AUTHORIZATION_VOIDED: "settlement.voided",
};
