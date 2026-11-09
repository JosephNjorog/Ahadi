import { z } from "zod";

/** SPEC §4.4 / AGENT_PROMPTS §2 output schema. Shared by agents, DB `criteria.spec` and the UI. */

export const MachineCheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("http_ok"), url: z.string().optional() }),
  z.object({
    kind: z.literal("lighthouse"),
    metric: z.enum(["performance", "accessibility", "seo", "best-practices"]),
    min: z.number().min(0).max(100),
  }),
  z.object({ kind: z.literal("lcp_ms"), max: z.number().positive() }),
  z.object({
    kind: z.literal("dom_contains"),
    selector: z.string().optional(),
    text: z.string().optional(),
    viewport: z.enum(["desktop", "mobile"]).optional(),
  }),
  z.object({ kind: z.literal("no_horizontal_scroll"), viewportWidth: z.number().int() }),
  z.object({ kind: z.literal("form_submits"), selector: z.string(), expectStatus: z.number().int() }),
  z.object({
    kind: z.literal("test_suite"),
    command: z.string(),
    minPassRate: z.number().min(0).max(1),
    hiddenSuiteId: z.string().optional(),
  }),
  z.object({ kind: z.literal("build_succeeds"), command: z.string() }),
  z.object({
    kind: z.literal("word_count"),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("min_citations"), count: z.number().int(), mustResolve: z.boolean() }),
  z.object({
    kind: z.literal("file_set"),
    patterns: z.array(z.string()),
    minCount: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal("image_dimensions"),
    width: z.number().int(),
    height: z.number().int(),
    tolerancePx: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("json_schema"), schemaArtifactId: z.string() }),
  z.object({
    kind: z.literal("csv_columns"),
    columns: z.array(z.string()),
    minRows: z.number().int().optional(),
  }),
]);
export type MachineCheck = z.infer<typeof MachineCheckSchema>;

export const EvidenceKindSchema = z.enum([
  "screenshot_desktop",
  "screenshot_mobile",
  "dom_snapshot",
  "lighthouse_report",
  "test_log",
  "build_log",
  "source_files",
  "text_content",
  "citations",
  "image",
  "dataset_profile",
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const CriterionMethodSchema = z.enum(["automated", "ai_judgment", "human"]);
export type CriterionMethod = z.infer<typeof CriterionMethodSchema>;

export const CriterionSchema = z.object({
  id: z.string().regex(/^c\d+$/),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  weight: z.number().int().min(1).max(100),
  required: z.boolean(),
  method: CriterionMethodSchema,
  check: MachineCheckSchema.optional(),
  evidence: z.array(EvidenceKindSchema).min(1),
  partialCredit: z.boolean(),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const CATEGORIES = ["web", "code", "design", "writing", "research", "data"] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** Canonical terms body stored in terms_versions.body and hashed for signing. */
export const TermsMilestoneSchema = z.object({
  position: z.number().int().min(1),
  title: z.string().min(1).max(80),
  summary: z.string().max(300).default(""),
  amountMinor: z.number().int().positive(),
  dueInDays: z.number().int().positive().optional(),
  deliverables: z.array(z.string()).min(1),
  criteria: z.array(CriterionSchema).min(1).max(8),
});
export type TermsMilestone = z.infer<typeof TermsMilestoneSchema>;

export const TermsBodySchema = z.object({
  title: z.string().min(1).max(100),
  category: CategorySchema,
  currency: z.string().length(3),
  scopeSummary: z.string().max(600),
  milestones: z.array(TermsMilestoneSchema).min(1).max(4),
  outOfScope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
});
export type TermsBody = z.infer<typeof TermsBodySchema>;

export interface TermsIssue {
  path: string;
  message: string;
}

/**
 * Code-level validation that the model (or a human editor) cannot bypass
 * (AGENT_PROMPTS §2 "Post-validation in code").
 */
export function validateTerms(body: TermsBody, budgetMinor?: number): TermsIssue[] {
  const issues: TermsIssue[] = [];
  const total = body.milestones.reduce((s, m) => s + m.amountMinor, 0);
  if (budgetMinor !== undefined && total !== budgetMinor) {
    issues.push({
      path: "milestones",
      message: `Milestone amounts sum to ${total}, budget is ${budgetMinor}`,
    });
  }
  body.milestones.forEach((m, i) => {
    const p = `milestones[${i}]`;
    const weights = m.criteria.reduce((s, c) => s + c.weight, 0);
    if (weights !== 100)
      issues.push({ path: p, message: `Criterion weights sum to ${weights}, must be 100` });
    const ids = new Set<string>();
    for (const c of m.criteria) {
      if (ids.has(c.id)) issues.push({ path: `${p}.${c.id}`, message: "Duplicate criterion id" });
      ids.add(c.id);
      if (c.method === "automated" && !c.check)
        issues.push({ path: `${p}.${c.id}`, message: "Automated criterion needs a machine check" });
      if (c.method !== "automated" && c.check)
        issues.push({ path: `${p}.${c.id}`, message: "Only automated criteria may have a machine check" });
    }
    if (m.criteria.filter((c) => c.required).length > 2)
      issues.push({ path: p, message: "At most 2 required criteria per milestone" });
    if (m.criteria.filter((c) => c.method === "human").length > 1)
      issues.push({ path: p, message: "At most 1 human criterion per milestone" });
  });
  const positions = body.milestones.map((m) => m.position);
  if (new Set(positions).size !== positions.length)
    issues.push({ path: "milestones", message: "Milestone positions must be unique" });
  return issues;
}
