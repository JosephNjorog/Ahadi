import type { MilestoneState, PromiseState } from "@ahadi/core/state";

export type Tone = "neutral" | "brand" | "warn" | "danger" | "info";

/** Human labels for each milestone state, per role (SPEC §20: plain words, short sentences). */
export const MILESTONE_STATUS: Record<MilestoneState, { label: string; tone: Tone; client: string; worker: string }> = {
  UNFUNDED: { label: "Not funded", tone: "neutral", client: "Fund this milestone through PayPal so work can start.", worker: "Waiting for the client to secure funds. Don't start yet." },
  FUNDING: { label: "Checkout open", tone: "warn", client: "Finish approving the payment in PayPal.", worker: "The client is securing funds." },
  FUNDED: { label: "Funds secured", tone: "brand", client: "PayPal is holding the money. It is only captured when the work is verified.", worker: "Funds are secured by PayPal. You can start work." },
  SUBMITTED: { label: "Submitted", tone: "info", client: "Work was submitted and is queued for verification.", worker: "Your work is queued for verification." },
  VERIFYING: { label: "Verifying", tone: "info", client: "Verifier agents are checking the work against the criteria.", worker: "Verifier agents are checking your work." },
  NEEDS_HUMAN: { label: "Needs review", tone: "warn", client: "Some criteria need a human decision before money moves.", worker: "A reviewer is looking at criteria the agents couldn't decide." },
  VERDICT_READY: { label: "Verdict ready", tone: "info", client: "The verdict is ready.", worker: "The verdict is ready." },
  OBJECTION_WINDOW: { label: "Decision window", tone: "warn", client: "Review the proposed release and accept or object.", worker: "Review the proposal: accept, resubmit or object." },
  MEDIATING: { label: "In mediation", tone: "warn", client: "A mediator is reviewing both sides.", worker: "A mediator is reviewing both sides." },
  SETTLING: { label: "Releasing", tone: "info", client: "Ahadi is capturing the agreed amount and releasing the rest of the hold.", worker: "Payment is being released to you." },
  SETTLED: { label: "Settled", tone: "brand", client: "Done. The verified amount was paid; any remainder went back to you.", worker: "Paid. The verified amount was sent to your PayPal." },
  SETTLEMENT_FAILED: { label: "Release failed", tone: "danger", client: "PayPal couldn't complete the release. Ahadi will retry.", worker: "PayPal couldn't complete the release. Ahadi will retry." },
  REFUNDING: { label: "Refunding", tone: "warn", client: "The hold is being released back to you.", worker: "The deadline passed without a submission." },
  VOIDED: { label: "Hold released", tone: "neutral", client: "Nothing was captured. PayPal released the hold.", worker: "Nothing was released for this milestone." },
  ESCALATED: { label: "Escalated", tone: "danger", client: "This went to PayPal's dispute process with Ahadi's evidence pack.", worker: "This went to PayPal's dispute process with Ahadi's evidence pack." },
};

export const PROMISE_STATUS: Record<PromiseState, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  NEGOTIATING: { label: "Negotiating", tone: "warn" },
  AGREED: { label: "Agreed", tone: "info" },
  ACTIVE: { label: "Active", tone: "brand" },
  DISPUTED: { label: "Disputed", tone: "danger" },
  COMPLETED: { label: "Completed", tone: "brand" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const METHOD_LABEL = { automated: "Automated", ai_judgment: "AI", human: "Human" } as const;
