import { describe, expect, it } from "vitest";
import {
  MILESTONE_EVENTS,
  MILESTONE_STATES,
  PROMISE_EVENTS,
  PROMISE_STATES,
  TERMINAL_MILESTONE_STATES,
  milestoneEventsFrom,
  nextMilestoneState,
  transitionMilestone,
  transitionPromise,
  type MilestoneEvent,
  type MilestoneState,
} from "../src/state";
import { IllegalTransitionError } from "../src/errors";

const LEGAL: [MilestoneState, MilestoneEvent, MilestoneState][] = [
  ["UNFUNDED", "ORDER_CREATED", "FUNDING"],
  ["FUNDING", "ORDER_CREATED", "FUNDING"],
  ["FUNDING", "AUTHORIZATION_CREATED", "FUNDED"],
  ["FUNDING", "FUNDING_CANCELLED", "UNFUNDED"],
  ["FUNDED", "WORK_SUBMITTED", "SUBMITTED"],
  ["FUNDED", "DEADLINE_MISSED", "REFUNDING"],
  ["FUNDED", "AUTHORIZATION_EXPIRED", "UNFUNDED"],
  ["SUBMITTED", "VERIFICATION_STARTED", "VERIFYING"],
  ["VERIFYING", "PROPOSAL_COMPUTED", "VERDICT_READY"],
  ["VERIFYING", "NEEDS_HUMAN_REVIEW", "NEEDS_HUMAN"],
  ["NEEDS_HUMAN", "HUMAN_REVIEWED", "VERDICT_READY"],
  ["VERDICT_READY", "PROPOSAL_PUBLISHED", "OBJECTION_WINDOW"],
  ["OBJECTION_WINDOW", "SETTLEMENT_APPROVED", "SETTLING"],
  ["OBJECTION_WINDOW", "RESUBMIT_CHOSEN", "FUNDED"],
  ["OBJECTION_WINDOW", "OBJECTION_RAISED", "MEDIATING"],
  ["MEDIATING", "MEDIATION_ACCEPTED", "SETTLING"],
  ["MEDIATING", "MEDIATION_RESUBMIT", "FUNDED"],
  ["MEDIATING", "MEDIATION_ESCALATED", "ESCALATED"],
  ["SETTLING", "SETTLEMENT_COMPLETED", "SETTLED"],
  ["SETTLING", "SETTLEMENT_FAILED", "SETTLEMENT_FAILED"],
  ["SETTLING", "AUTHORIZATION_VOIDED", "VOIDED"],
  ["SETTLEMENT_FAILED", "SETTLEMENT_RETRIED", "SETTLING"],
  ["REFUNDING", "AUTHORIZATION_VOIDED", "VOIDED"],
];

describe("milestone state machine", () => {
  it.each(LEGAL)("%s --%s--> %s", (from, event, to) => {
    expect(transitionMilestone(from, event)).toBe(to);
  });

  it("throws on every illegal transition", () => {
    const legal = new Set(LEGAL.map(([f, e]) => `${f}:${e}`));
    let illegal = 0;
    for (const s of MILESTONE_STATES) {
      for (const e of MILESTONE_EVENTS) {
        if (legal.has(`${s}:${e}`)) continue;
        illegal++;
        expect(nextMilestoneState(s, e)).toBeNull();
        expect(() => transitionMilestone(s, e)).toThrow(IllegalTransitionError);
      }
    }
    expect(illegal).toBe(MILESTONE_STATES.length * MILESTONE_EVENTS.length - LEGAL.length);
  });

  it("terminal states have no exits", () => {
    for (const s of TERMINAL_MILESTONE_STATES) expect(milestoneEventsFrom(s)).toEqual([]);
  });

  it("every non-terminal state can reach a terminal state", () => {
    for (const start of MILESTONE_STATES) {
      const seen = new Set<MilestoneState>([start]);
      const queue = [start];
      while (queue.length) {
        const s = queue.shift()!;
        for (const e of milestoneEventsFrom(s)) {
          const n = nextMilestoneState(s, e)!;
          if (!seen.has(n)) (seen.add(n), queue.push(n));
        }
      }
      expect([...seen].some((s) => TERMINAL_MILESTONE_STATES.has(s))).toBe(true);
    }
  });
});

describe("promise state machine", () => {
  it("follows the happy path", () => {
    let s = transitionPromise("DRAFT", "INVITE_SENT");
    s = transitionPromise(s, "TERMS_EDITED");
    s = transitionPromise(s, "BOTH_SIGNED");
    s = transitionPromise(s, "FIRST_MILESTONE_FUNDED");
    s = transitionPromise(s, "MEDIATION_OPENED");
    s = transitionPromise(s, "MEDIATION_RESOLVED");
    expect(transitionPromise(s, "ALL_MILESTONES_TERMINAL")).toBe("COMPLETED");
  });

  it("rejects illegal moves", () => {
    expect(() => transitionPromise("DRAFT", "BOTH_SIGNED")).toThrow(IllegalTransitionError);
    expect(() => transitionPromise("ACTIVE", "CANCELLED")).toThrow(IllegalTransitionError);
    for (const e of PROMISE_EVENTS) {
      expect(() => transitionPromise("COMPLETED", e)).toThrow();
      expect(() => transitionPromise("CANCELLED", e)).toThrow();
    }
    expect(PROMISE_STATES).toContain("DISPUTED");
  });
});
