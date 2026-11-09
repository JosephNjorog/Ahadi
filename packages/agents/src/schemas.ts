import { z } from "zod";
import { CriterionSchema, EvidenceKindSchema, MachineCheckSchema } from "@ahadi/core/criteria";

/** Output schemas from docs/AGENT_PROMPTS.md. The runner sends each as a JSON-schema output format. */

export const CriterionDraft = CriterionSchema;
export { EvidenceKindSchema, MachineCheckSchema };

export const MilestoneDraft = z.object({
  title: z.string().max(80),
  summary: z.string().max(300),
  amountMinor: z.number().int().positive(),
  dueInDays: z.number().int().positive().optional(),
  deliverables: z.array(z.string()).min(1),
  criteria: z.array(CriterionDraft).min(3).max(8),
});

export const ContractDraft = z.object({
  title: z.string().max(100),
  scopeSummary: z.string().max(600),
  milestones: z.array(MilestoneDraft).min(1).max(4),
  outOfScope: z.array(z.string()),
  assumptions: z.array(z.string()),
  questionsForClient: z.array(z.string()).max(5),
  changeSummary: z.string().optional(),
  manipulationNotes: z.string().optional(),
});
export type ContractDraft = z.infer<typeof ContractDraft>;

export const CRITIQUE_CODES = [
  "VAGUE",
  "UNVERIFIABLE",
  "COMPOUND",
  "GAMEABLE",
  "UNFAIR_TO_WORKER",
  "UNFAIR_TO_CLIENT",
  "WRONG_METHOD",
  "WEIGHT_MISMATCH",
  "MISSING",
] as const;

export const CriteriaCritique = z.object({
  verdict: z.enum(["ready", "needs_changes"]),
  issues: z.array(
    z.object({
      milestoneIndex: z.number().int(),
      criterionId: z.string().nullable(),
      code: z.enum(CRITIQUE_CODES),
      explanation: z.string().max(300),
      suggestedCriterion: CriterionDraft.optional(),
    }),
  ),
});
export type CriteriaCritique = z.infer<typeof CriteriaCritique>;

export const InjectionReport = z.object({
  overall: z.enum(["clean", "suspicious", "injection"]),
  findings: z.array(
    z.object({
      findingId: z.string(),
      classification: z.enum(["benign", "suspicious", "injection"]),
      reason: z.string().max(200),
      quoteForClient: z.string().max(200),
    }),
  ),
  summaryForClient: z.string().max(300),
});
export type InjectionReport = z.infer<typeof InjectionReport>;

export const CriterionVerdict = z.object({
  criterionId: z.string(),
  restatement: z.string().max(200),
  outcome: z.enum(["pass", "partial", "fail", "undetermined"]),
  credit: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
  howToFix: z.string().max(300).optional(),
  evidenceArtifactIds: z.array(z.string()).min(1),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdict>;

export const CriterionVerdicts = z.object({
  verdicts: z.array(CriterionVerdict),
  manipulationDetected: z.boolean(),
  manipulationNotes: z.string().max(300).optional(),
  overallSummary: z.string().max(400),
});
export type CriterionVerdicts = z.infer<typeof CriterionVerdicts>;

export const ReviewerOutput = CriterionVerdicts.extend({
  comparisons: z.array(
    z.object({ criterionId: z.string(), agreesWithPrevious: z.boolean(), note: z.string().max(300) }),
  ),
});
export type ReviewerOutput = z.infer<typeof ReviewerOutput>;

export const MediationResult = z.object({
  clientPosition: z.string().max(300),
  workerPosition: z.string().max(300),
  disagreements: z.array(
    z.object({
      criterionId: z.string().nullable(),
      category: z.enum(["VERIFICATION_ERROR", "NEW_EVIDENCE", "OUT_OF_SCOPE", "AMBIGUOUS_TERMS", "CONDUCT"]),
      finding: z.string().max(400),
    }),
  ),
  resolution: z.enum(["uphold", "adjust", "resubmit", "escalate"]),
  adjustments: z.array(
    z.object({
      criterionId: z.string(),
      newOutcome: z.enum(["pass", "partial", "fail"]),
      newCredit: z.number().min(0).max(1),
      reason: z.string().max(300),
    }),
  ),
  resubmitFixList: z.array(z.string()).optional(),
  escalationReason: z.string().optional(),
  messageToParties: z.string().max(1200),
  manipulationNotes: z.string().optional(),
});
export type MediationResult = z.infer<typeof MediationResult>;

export const Explanation = z.object({
  headline: z.string().max(140),
  body: z.string().max(600),
  nextSteps: z.string().max(300),
});
export type Explanation = z.infer<typeof Explanation>;

export const RiskAssessment = z.object({
  level: z.enum(["low", "medium", "high"]),
  action: z.enum(["none", "monitor", "manual_review", "hold_payout"]),
  reasons: z.array(z.object({ signal: z.string(), assessment: z.string().max(300) })),
  summaryForAdmin: z.string().max(500),
});
export type RiskAssessment = z.infer<typeof RiskAssessment>;

export const ConciergeAction = z.object({
  action: z.enum(["view_promise", "accept_terms", "submit_link", "check_payment", "decision_link", "help"]),
  promiseId: z.string().nullable(),
  milestone: z.number().int().nullable(),
  submittedUrl: z.string().nullable(),
  reply: z.string().max(600),
});
export type ConciergeAction = z.infer<typeof ConciergeAction>;
