import { formatMoney, validateTerms, type Category, type Criterion, type TermsBody } from "@ahadi/core";
import {
  architectSystem,
  conciergeSystem,
  criticSystem,
  explainerSystem,
  mediatorSystem,
  PROMPTS,
  reviewerSystem,
  riskSystem,
  sentinelSystem,
  verifierSystem,
} from "./prompts";
import { runStructured, type ContentBlock } from "./runner";
import {
  ConciergeAction,
  ContractDraft,
  CriteriaCritique,
  CriterionVerdicts,
  Explanation,
  InjectionReport,
  MediationResult,
  ReviewerOutput,
  RiskAssessment,
} from "./schemas";
import { newNonce, untrusted } from "./untrusted";

const json = (v: unknown) => JSON.stringify(v, null, 2);

/* ─────────────── Contract Architect (AGENT_PROMPTS §2) ─────────────── */

export async function draftContract(args: {
  promiseId: string;
  brief: string;
  category: Category;
  budgetMinor: number;
  currency: string;
  deadline: Date | null;
  templateCriteria?: unknown;
  previous?: TermsBody;
  editRequest?: string;
}) {
  const nonce = newNonce();
  const content: ContentBlock[] = [{ type: "text", text: untrusted(nonce, "brief", "client", args.brief) }];
  if (args.previous && args.editRequest) {
    content.push({
      type: "text",
      text: `Previous terms (keep criterion ids stable where meaning is unchanged):\n${json(args.previous)}`,
    });
    content.push({ type: "text", text: untrusted(nonce, "edit-request", "party", args.editRequest) });
  }
  content.push({
    type: "text",
    text: `Budget in minor units: ${args.budgetMinor}. Milestone amountMinor values must sum to exactly this.`,
  });
  const res = await runStructured({
    meta: PROMPTS.architect,
    system: architectSystem({
      nonce,
      category: args.category,
      budget: formatMoney(args.budgetMinor, args.currency),
      currency: args.currency,
      deadline: args.deadline ? args.deadline.toISOString().slice(0, 10) : "none given",
      templateCriteriaJson: args.templateCriteria ? JSON.stringify(args.templateCriteria) : "[]",
    }),
    content,
    schema: ContractDraft,
    subject: { type: "promise", id: args.promiseId },
    validate: (d) =>
      validateTerms(toTermsBody(d, args.category, args.currency), args.budgetMinor).map(
        (i) => `${i.path}: ${i.message}`,
      ),
  });
  return {
    draft: res.output,
    body: toTermsBody(res.output, args.category, args.currency),
    usage: res.usage,
    model: res.model,
    promptVersion: res.promptVersion,
  };
}

export function toTermsBody(d: ContractDraft, category: Category, currency: string): TermsBody {
  return {
    title: d.title,
    category,
    currency,
    scopeSummary: d.scopeSummary,
    outOfScope: d.outOfScope,
    assumptions: d.assumptions,
    milestones: d.milestones.map((m, i) => ({
      position: i + 1,
      title: m.title,
      summary: m.summary,
      amountMinor: m.amountMinor,
      ...(m.dueInDays ? { dueInDays: m.dueInDays } : {}),
      deliverables: m.deliverables,
      criteria: m.criteria,
    })),
  };
}

/* ─────────────── Criteria Critic (§3) ─────────────── */

export async function critiqueContract(args: { termsVersionId: string; brief: string; body: TermsBody }) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.critic,
    system: criticSystem(nonce),
    content: [
      { type: "text", text: `Category: ${args.body.category}` },
      { type: "text", text: `Brief:\n${untrusted(nonce, "brief", "client", args.brief)}` },
      { type: "text", text: `Draft contract:\n${json(args.body)}` },
    ],
    schema: CriteriaCritique,
    subject: { type: "terms_version", id: args.termsVersionId },
    validate: (c) => {
      const out: string[] = [];
      if (c.verdict === "ready" && c.issues.length > 0) out.push('verdict "ready" must have no issues');
      for (const i of c.issues) {
        if (!args.body.milestones[i.milestoneIndex])
          out.push(`milestoneIndex ${i.milestoneIndex} does not exist`);
        if (i.code !== "MISSING" && !i.criterionId) out.push(`${i.code} issue needs a criterionId`);
      }
      return out;
    },
  });
  return res.output;
}

/* ─────────────── Injection Sentinel (§4) ─────────────── */

export interface ScannerFinding {
  id: string;
  kind: string;
  location: string;
  text: string;
  hidden: boolean;
  patterns: string[];
}

export async function classifyInjection(args: {
  verificationId: string;
  findings: ScannerFinding[];
  excerpts: string;
}) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.sentinel,
    system: sentinelSystem(nonce),
    content: [
      {
        type: "text",
        text: `Scanner findings:\n${args.findings
          .map(
            (f) =>
              `- id=${f.id} kind=${f.kind} hidden=${f.hidden} location=${f.location} patterns=[${f.patterns.join(",")}]\n${untrusted(nonce, f.id, "deliverable", f.text.slice(0, 2000))}`,
          )
          .join("\n")}`,
      },
      {
        type: "text",
        text: `Visible text excerpts:\n${untrusted(nonce, "excerpts", "deliverable", args.excerpts.slice(0, 8000))}`,
      },
    ],
    schema: InjectionReport,
    subject: { type: "verification", id: args.verificationId },
    validate: (r) => {
      const ids = new Set(args.findings.map((f) => f.id));
      const out = r.findings
        .filter((f) => !ids.has(f.findingId))
        .map((f) => `Unknown findingId ${f.findingId}`);
      if (r.findings.some((f) => f.classification === "injection") && r.overall !== "injection")
        out.push('overall must be "injection" when any finding is injection');
      return out;
    },
  });
  return res.output;
}

/* ─────────────── Verifiers (§5) and Reviewer (§6) ─────────────── */

export interface VerifierEvidence {
  summary: unknown;
  images: {
    artifactId: string;
    label: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    base64: string;
  }[];
  untrustedBlocks: { id: string; source: string; text: string }[];
  machineResults: unknown;
  artifactIds: string[];
}

function evidenceContent(nonce: string, criteria: Criterion[], ev: VerifierEvidence): ContentBlock[] {
  const blocks: ContentBlock[] = [
    { type: "text", text: `## Your criteria\n${json(criteria)}` },
    { type: "text", text: `## Evidence summary (artifact id "evidence-summary")\n${json(ev.summary)}` },
  ];
  for (const img of ev.images) {
    blocks.push({ type: "text", text: `Image artifact ${img.artifactId}: ${img.label}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  }
  for (const b of ev.untrustedBlocks)
    blocks.push({ type: "text", text: untrusted(nonce, b.id, b.source, b.text) });
  blocks.push({
    type: "text",
    text: `## Machine check results (already decided, context only)\n${json(ev.machineResults)}`,
  });
  blocks.push({
    type: "text",
    text: `Valid artifact ids: ${["evidence-summary", ...ev.artifactIds].join(", ")}`,
  });
  return blocks;
}

/** AGENT_PROMPTS §5.1 post-validation: one verdict per criterion, credit consistent, partial only where allowed, ids exist. */
export function postValidateVerdicts(
  criteria: Criterion[],
  v: CriterionVerdicts,
  artifactIds: string[],
): { problems: string[]; fixed: CriterionVerdicts } {
  const problems: string[] = [];
  const ids = new Set(criteria.map((c) => c.id));
  const valid = new Set(["evidence-summary", ...artifactIds]);
  for (const c of criteria)
    if (!v.verdicts.find((x) => x.criterionId === c.id)) problems.push(`Missing verdict for ${c.id}`);
  for (const x of v.verdicts)
    if (!ids.has(x.criterionId)) problems.push(`Verdict for unknown criterion ${x.criterionId}`);
  for (const x of v.verdicts) {
    const bad = x.evidenceArtifactIds.filter((a) => !valid.has(a));
    if (bad.length) problems.push(`${x.criterionId} cites unknown artifact ids: ${bad.join(", ")}`);
  }
  const fixed: CriterionVerdicts = {
    ...v,
    verdicts: v.verdicts.map((x) => {
      const c = criteria.find((k) => k.id === x.criterionId);
      if (x.outcome === "pass") return { ...x, credit: 1 };
      if (x.outcome === "fail" || x.outcome === "undetermined") return { ...x, credit: 0 };
      if (c && !c.partialCredit)
        return { ...x, outcome: "fail", credit: 0, confidence: Math.min(x.confidence, 0.6) };
      return { ...x, credit: Math.min(0.95, Math.max(0.05, x.credit)) };
    }),
  };
  return { problems, fixed };
}

export async function verifyCriteria(args: {
  verificationId: string;
  category: string;
  criteria: Criterion[];
  evidence: VerifierEvidence;
}) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.verifier,
    system: verifierSystem(nonce, args.category),
    content: evidenceContent(nonce, args.criteria, args.evidence),
    schema: CriterionVerdicts,
    subject: { type: "verification", id: args.verificationId },
    validate: (v) => postValidateVerdicts(args.criteria, v, args.evidence.artifactIds).problems,
  });
  return postValidateVerdicts(args.criteria, res.output, args.evidence.artifactIds).fixed;
}

export async function reviewVerdicts(args: {
  verificationId: string;
  criteria: Criterion[];
  previous: unknown;
  evidence: VerifierEvidence;
}) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.reviewer,
    system: reviewerSystem(nonce),
    content: [
      { type: "text", text: `Previous verdicts:\n${json(args.previous)}` },
      ...evidenceContent(nonce, args.criteria, args.evidence),
    ],
    schema: ReviewerOutput,
    subject: { type: "verification", id: args.verificationId },
    validate: (v) => postValidateVerdicts(args.criteria, v, args.evidence.artifactIds).problems,
  });
  const { fixed } = postValidateVerdicts(args.criteria, res.output, args.evidence.artifactIds);
  return { ...res.output, verdicts: fixed.verdicts };
}

/* ─────────────── Mediator (§7) ─────────────── */

export async function mediate(args: {
  mediationId: string;
  terms: unknown;
  verification: unknown;
  proposal: { releasePct: string; capture: string; milestoneAmount: string };
  clientStatement: string | null;
  workerStatement: string | null;
  newEvidence: string;
  timeline: string;
  criterionIds: string[];
}) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.mediator,
    system: mediatorSystem(nonce),
    content: [
      { type: "text", text: `Signed terms (agreed by both before work started):\n${json(args.terms)}` },
      { type: "text", text: `Verification results per criterion:\n${json(args.verification)}` },
      {
        type: "text",
        text: `Current proposal (computed by fixed rules): release ${args.proposal.releasePct} = ${args.proposal.capture} of ${args.proposal.milestoneAmount}`,
      },
      {
        type: "text",
        text: `Client's statement:\n${untrusted(nonce, "client-statement", "client", args.clientStatement ?? "(none)")}`,
      },
      {
        type: "text",
        text: `Worker's statement:\n${untrusted(nonce, "worker-statement", "worker", args.workerStatement ?? "(none)")}`,
      },
      {
        type: "text",
        text: `New evidence submitted during mediation:\n${untrusted(nonce, "new-evidence", "party", args.newEvidence || "(none)")}`,
      },
      { type: "text", text: `Timeline:\n${args.timeline}` },
    ],
    schema: MediationResult,
    subject: { type: "mediation", id: args.mediationId },
    validate: (m) => {
      const ids = new Set(args.criterionIds);
      const out = m.adjustments
        .filter((a) => !ids.has(a.criterionId))
        .map((a) => `Adjustment for unknown criterion ${a.criterionId}`);
      if (m.resolution === "adjust" && m.adjustments.length === 0)
        out.push('"adjust" needs at least one adjustment');
      if (m.resolution !== "adjust" && m.adjustments.length > 0)
        out.push("adjustments are only allowed with resolution adjust");
      if (m.resolution === "resubmit" && !m.resubmitFixList?.length) out.push('"resubmit" needs a fix list');
      return out;
    },
  });
  return res.output;
}

/* ─────────────── Settlement Explainer (§8) ─────────────── */

/** Every currency amount in the text must appear verbatim in the facts (AGENT_PROMPTS §8 code check). */
export function amountsNotInFacts(text: string, allowed: string[]): string[] {
  const found =
    text.match(/(?:[$€£]|KES|USD|KSh)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|KES)/g) ?? [];
  const norm = (s: string) => s.replace(/\s|,/g, "").replace(/^KSh/, "KES");
  const ok = new Set(allowed.map(norm));
  return found.filter((f) => !ok.has(norm(f)));
}

export async function explainProposal(args: {
  proposalId: string;
  audience: "client" | "worker";
  language?: "en" | "sw";
  facts: Record<string, string>;
  criteria: unknown;
  windowEndsAt: string;
}) {
  const allowed = Object.values(args.facts).filter((v) => /\d/.test(v));
  const res = await runStructured({
    meta: PROMPTS.explainer,
    system: explainerSystem({ audience: args.audience, language: args.language ?? "en" }),
    content: [
      {
        type: "text",
        text: `Facts (use exactly):\n${Object.entries(args.facts)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")}`,
      },
      { type: "text", text: `Criteria:\n${json(args.criteria)}` },
      { type: "text", text: `Decision window ends: ${args.windowEndsAt}` },
    ],
    schema: Explanation,
    subject: { type: "proposal", id: args.proposalId },
    validate: (e) => {
      const bad = amountsNotInFacts(`${e.headline} ${e.body} ${e.nextSteps}`, allowed);
      return bad.length
        ? [`These amounts are not in the facts: ${bad.join(", ")}. Use only the facts' amounts.`]
        : [];
    },
  });
  return res.output;
}

/* ─────────────── Risk Analyst (§9) ─────────────── */

export async function assessRisk(args: {
  promiseId: string;
  signals: unknown;
  promiseSummary: string;
  clientHistory: string;
  workerHistory: string;
}) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.risk,
    system: riskSystem(nonce),
    content: [
      { type: "text", text: `Signals from automated rules:\n${json(args.signals)}` },
      {
        type: "text",
        text: `Promise summary:\n${untrusted(nonce, "promise", "party", args.promiseSummary)}`,
      },
      { type: "text", text: `Client history:\n${args.clientHistory}` },
      { type: "text", text: `Worker history:\n${args.workerHistory}` },
    ],
    schema: RiskAssessment,
    subject: { type: "promise", id: args.promiseId },
  });
  return res.output;
}

/* ─────────────── WhatsApp Concierge (§10) ─────────────── */

export async function conciergeDecide(args: {
  messageId: string;
  userName: string;
  language: string;
  promises: unknown;
  history: string;
  message: string;
}) {
  const nonce = newNonce();
  const res = await runStructured({
    meta: PROMPTS.concierge,
    system: conciergeSystem({ nonce, language: args.language, userName: args.userName }),
    content: [
      { type: "text", text: `Their active promises:\n${json(args.promises)}` },
      {
        type: "text",
        text: `Recent messages:\n${untrusted(nonce, "history", "chat", args.history || "(none)")}`,
      },
      { type: "text", text: `New message:\n${untrusted(nonce, "message", "user", args.message)}` },
    ],
    schema: ConciergeAction,
    subject: { type: "whatsapp_message", id: args.messageId },
  });
  return res.output;
}
