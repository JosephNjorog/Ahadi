import { sql } from "drizzle-orm";
import {
  customType,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { Criterion, TermsBody } from "@ahadi/core";

/**
 * Database schema — SPEC §5 (plus §14 services, auth tokens and a job dead-letter table).
 * Money is integer minor units (`*_minor`) + ISO 4217 currency.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const minor = (name: string) => bigint(name, { mode: "number" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/* ─────────────── Identity ─────────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  paypalEmail: text("paypal_email"),
  paypalPayerId: text("paypal_payer_id"),
  country: text("country"),
  phoneE164: text("phone_e164"),
  role: text("role", { enum: ["member", "admin"] })
    .notNull()
    .default("member"),
  passportSlug: text("passport_slug").unique(),
  createdAt: createdAt(),
});

/** Single-use magic-link tokens (only the SHA-256 is stored). */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_email_idx").on(t.email)],
);

export const agents = pgTable("agents", {
  id: id(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["buyer", "provider", "both"] }).notNull(),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  /** First characters of the key ("ahk_live_ab12…") so owners can tell keys apart. */
  apiKeyPrefix: text("api_key_prefix").notNull().default(""),
  description: text("description"),
  providerWebhookUrl: text("provider_webhook_url"),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const mandates = pgTable("mandates", {
  id: id(),
  agentId: uuid("agent_id")
    .notNull()
    .unique()
    .references(() => agents.id),
  perJobMaxMinor: minor("per_job_max_minor").notNull(),
  monthlyMaxMinor: minor("monthly_max_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  allowedCategories: text("allowed_categories").array().notNull(),
  minProviderScore: numeric("min_provider_score", { precision: 4, scale: 3, mode: "number" })
    .notNull()
    .default(0),
  requireOwnerApprovalAboveMinor: minor("require_owner_approval_above_minor"),
  active: boolean("active").notNull().default(true),
  updatedAt: updatedAt(),
});

/* ─────────────── Promises ─────────────── */

export const promises = pgTable(
  "promises",
  {
    id: id(),
    title: text("title").notNull(),
    category: text("category", { enum: ["web", "code", "design", "writing", "research", "data"] }).notNull(),
    clientUserId: uuid("client_user_id").references(() => users.id),
    clientAgentId: uuid("client_agent_id").references(() => agents.id),
    workerUserId: uuid("worker_user_id").references(() => users.id),
    workerAgentId: uuid("worker_agent_id").references(() => agents.id),
    state: text("state").notNull().default("DRAFT"),
    currency: text("currency").notNull().default("USD"),
    currentTermsVersionId: uuid("current_terms_version_id"),
    sourceBrief: text("source_brief"),
    budgetMinor: minor("budget_minor"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    inviteEmail: text("invite_email"),
    serviceId: uuid("service_id"),
    /** idle | generating | failed — Contract Architect job state for the terms editor. */
    termsStatus: text("terms_status", { enum: ["idle", "generating", "failed"] }).notNull().default("idle"),
    termsError: text("terms_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("promises_client_idx").on(t.clientUserId), index("promises_worker_idx").on(t.workerUserId)],
);

export const termsVersions = pgTable(
  "terms_versions",
  {
    id: id(),
    promiseId: uuid("promise_id")
      .notNull()
      .references(() => promises.id),
    version: integer("version").notNull(),
    body: jsonb("body").$type<TermsBody>().notNull(),
    bodyHash: text("body_hash").notNull(),
    authorId: uuid("author_id"),
    source: text("source", { enum: ["architect", "manual", "seed", "template"] }).notNull().default("architect"),
    changeSummary: text("change_summary"),
    /** Criteria Critic output (AGENT_PROMPTS §3). */
    critique: jsonb("critique"),
    /** questionsForClient, manipulationNotes from the Architect. */
    notes: jsonb("notes"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.promiseId, t.version)],
);

export const signatures = pgTable(
  "signatures",
  {
    id: id(),
    termsVersionId: uuid("terms_version_id")
      .notNull()
      .references(() => termsVersions.id),
    party: text("party", { enum: ["client", "worker"] }).notNull(),
    signerUserId: uuid("signer_user_id").references(() => users.id),
    signerAgentId: uuid("signer_agent_id").references(() => agents.id),
    bodyHash: text("body_hash").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.termsVersionId, t.party)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    promiseId: uuid("promise_id")
      .notNull()
      .references(() => promises.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    state: text("state").notNull().default("UNFUNDED"),
    maxAttempts: integer("max_attempts").notNull().default(3),
    attemptsUsed: integer("attempts_used").notNull().default(0),
    fundingAttempts: integer("funding_attempts").notNull().default(0),
  },
  (t) => [
    unique().on(t.promiseId, t.position),
    check("milestones_amount_positive", sql`${t.amountMinor} > 0`),
    index("milestones_state_idx").on(t.state),
  ],
);

export const criteria = pgTable(
  "criteria",
  {
    id: id(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id),
    key: text("key").notNull(),
    spec: jsonb("spec").$type<Criterion>().notNull(),
    weight: integer("weight").notNull(),
    required: boolean("required").notNull().default(false),
  },
  (t) => [
    unique().on(t.milestoneId, t.key),
    check("criteria_weight_range", sql`${t.weight} between 0 and 100`),
  ],
);

export const splits = pgTable(
  "splits",
  {
    id: id(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id),
    recipientUserId: uuid("recipient_user_id").references(() => users.id),
    recipientPaypalEmail: text("recipient_paypal_email").notNull(),
    shareBps: integer("share_bps").notNull(),
  },
  (t) => [check("splits_share_range", sql`${t.shareBps} between 1 and 10000`)],
);

/* ─────────────── PayPal funding ─────────────── */

export const FUNDING_STATUSES = [
  "CREATED",
  "APPROVED",
  "AUTHORIZED",
  "REAUTHORIZED",
  "PARTIALLY_CAPTURED",
  "CAPTURED",
  "VOIDED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

/**
 * One row per PayPal order. SPEC has milestone_id unique; we keep every attempt (a buyer may
 * abandon checkout and retry) and enforce "one live funding per milestone" in the service layer.
 */
export const fundings = pgTable(
  "fundings",
  {
    id: id(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id),
    attempt: integer("attempt").notNull().default(1),
    paypalOrderId: text("paypal_order_id").notNull().unique(),
    paypalAuthorizationId: text("paypal_authorization_id").unique(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: FUNDING_STATUSES }).notNull(),
    payerEmail: text("payer_email"),
    payerId: text("payer_id"),
    honorExpiresAt: timestamp("honor_expires_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reauthorizedAt: timestamp("reauthorized_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.milestoneId, t.attempt),
    index("fundings_status_honor_idx").on(t.status, t.honorExpiresAt),
  ],
);

/* ─────────────── Work ─────────────── */

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id),
    attempt: integer("attempt").notNull(),
    kind: text("kind", { enum: ["url", "repo", "files", "text"] }).notNull(),
    url: text("url"),
    repoUrl: text("repo_url"),
    commitSha: text("commit_sha"),
    text: text("text"),
    note: text("note"),
    submittedByUserId: uuid("submitted_by_user_id"),
    submittedByAgentId: uuid("submitted_by_agent_id"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.milestoneId, t.attempt)],
);

export const artifacts = pgTable("artifacts", {
  id: id(),
  submissionId: uuid("submission_id").references(() => submissions.id),
  verificationId: uuid("verification_id"),
  role: text("role", { enum: ["deliverable", "evidence"] }).notNull(),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256").notNull(),
  mime: text("mime").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  meta: jsonb("meta"),
  /** Inline storage (driver "db"); null when stored in an S3-compatible bucket under storage_key. */
  data: bytea("data"),
  createdAt: createdAt(),
});

export const verifications = pgTable("verifications", {
  id: id(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  termsVersionId: uuid("terms_version_id")
    .notNull()
    .references(() => termsVersions.id),
  status: text("status", { enum: ["RUNNING", "COMPLETE", "NEEDS_HUMAN", "FAILED"] }).notNull(),
  injectionFlagged: boolean("injection_flagged").notNull().default(false),
  injectionReport: jsonb("injection_report"),
  summary: text("summary"),
  /** Pipeline stage for the live UI: fetching | scanning | collecting | checking | judging | reviewing | settling | done */
  stage: text("stage"),
  evidence: jsonb("evidence"),
  error: text("error"),
  modelUsage: jsonb("model_usage"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const criterionResults = pgTable(
  "criterion_results",
  {
    id: id(),
    verificationId: uuid("verification_id")
      .notNull()
      .references(() => verifications.id),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => criteria.id),
    outcome: text("outcome", { enum: ["pass", "partial", "fail", "undetermined"] }).notNull(),
    credit: numeric("credit", { precision: 3, scale: 2, mode: "number" }).notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2, mode: "number" }).notNull(),
    decidedBy: text("decided_by", { enum: ["machine", "agent", "human"] }).notNull(),
    reasoning: text("reasoning").notNull(),
    howToFix: text("how_to_fix"),
    evidenceArtifactIds: uuid("evidence_artifact_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
  },
  (t) => [unique().on(t.verificationId, t.criterionId)],
);

export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    verificationId: uuid("verification_id")
      .notNull()
      .unique()
      .references(() => verifications.id),
    releaseBps: integer("release_bps").notNull(),
    captureMinor: minor("capture_minor").notNull(),
    platformFeeMinor: minor("platform_fee_minor").notNull(),
    requiresHumanConfirm: boolean("requires_human_confirm").notNull().default(false),
    blockedReason: text("blocked_reason"),
    explanation: text("explanation").notNull(),
    /** Settlement Explainer output per audience (AGENT_PROMPTS §8). */
    explanationClient: jsonb("explanation_client"),
    explanationWorker: jsonb("explanation_worker"),
    /** Set when replaced (resubmission or mediation recompute). */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    mediationId: uuid("mediation_id"),
    clientDecision: text("client_decision", { enum: ["accept", "object"] }),
    workerDecision: text("worker_decision", { enum: ["accept", "resubmit", "object"] }),
    windowEndsAt: timestamp("window_ends_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("proposals_release_range", sql`${t.releaseBps} between 0 and 10000`),
    index("proposals_window_idx")
      .on(t.windowEndsAt)
      .where(sql`${t.clientDecision} is null`),
  ],
);

export const settlements = pgTable("settlements", {
  id: id(),
  proposalId: uuid("proposal_id")
    .notNull()
    .unique()
    .references(() => proposals.id),
  status: text("status", {
    enum: ["PENDING", "CAPTURE_PENDING", "CAPTURED", "VOIDED", "PAID", "FAILED"],
  }).notNull(),
  paypalCaptureId: text("paypal_capture_id").unique(),
  capturedMinor: minor("captured_minor"),
  paypalFeeMinor: minor("paypal_fee_minor"),
  netMinor: minor("net_minor"),
  error: jsonb("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const payouts = pgTable("payouts", {
  id: id(),
  settlementId: uuid("settlement_id")
    .notNull()
    .references(() => settlements.id),
  recipientPaypalEmail: text("recipient_paypal_email").notNull(),
  amountMinor: minor("amount_minor").notNull(),
  currency: text("currency").notNull(),
  senderBatchId: text("sender_batch_id").notNull(),
  senderItemId: text("sender_item_id").notNull().unique(),
  paypalPayoutBatchId: text("paypal_payout_batch_id"),
  paypalPayoutItemId: text("paypal_payout_item_id"),
  status: text("status", { enum: ["PENDING", "SUCCESS", "UNCLAIMED", "FAILED", "RETURNED"] }).notNull(),
  raw: jsonb("raw"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ─────────────── Disputes and mediation ─────────────── */

export const mediations = pgTable("mediations", {
  id: id(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  openedBy: text("opened_by", { enum: ["client", "worker"] }).notNull(),
  clientStatement: text("client_statement"),
  workerStatement: text("worker_statement"),
  aiResolution: jsonb("ai_resolution"),
  outcome: text("outcome", { enum: ["accepted", "rejected", "escalated", "resubmit"] }),
  status: text("status", { enum: ["OPEN", "RUNNING", "PROPOSED", "CLOSED"] }).notNull().default("OPEN"),
  proposalId: uuid("proposal_id"),
  resolutionProposalId: uuid("resolution_proposal_id"),
  clientDecision: text("client_decision", { enum: ["accept", "reject"] }),
  workerDecision: text("worker_decision", { enum: ["accept", "reject"] }),
  rejections: integer("rejections").notNull().default(0),
  paypalDisputeId: text("paypal_dispute_id"),
  createdAt: createdAt(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

/* ─────────────── Ledger ─────────────── */

export const ledgerEvents = pgTable(
  "ledger_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    promiseId: uuid("promise_id")
      .notNull()
      .references(() => promises.id),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull(),
  },
  (t) => [unique().on(t.promiseId, t.seq)],
);

/* ─────────────── Infrastructure ─────────────── */

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  payload: jsonb("payload").notNull(),
  verified: boolean("verified").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskFlags = pgTable("risk_flags", {
  id: id(),
  subjectType: text("subject_type", { enum: ["user", "promise", "submission"] }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  code: text("code").notNull(),
  severity: text("severity", { enum: ["low", "medium", "high"] }).notNull(),
  detail: jsonb("detail").notNull(),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/** Jobs that exhausted their retries (SPEC §17 "Dead letters go to an admin view"). */
export const jobFailures = pgTable("job_failures", {
  id: id(),
  queue: text("queue").notNull(),
  jobName: text("job_name").notNull(),
  jobId: text("job_id"),
  data: jsonb("data"),
  error: text("error").notNull(),
  attempts: integer("attempts").notNull(),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/* ─────────────── Marketplace (SPEC §14) ─────────────── */

export const services = pgTable("services", {
  id: id(),
  providerUserId: uuid("provider_user_id").references(() => users.id),
  providerAgentId: uuid("provider_agent_id").references(() => agents.id),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priceMinor: minor("price_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  defaultCriteria: jsonb("default_criteria"),
  turnaroundHours: integer("turnaround_hours").notNull(),
  active: boolean("active").notNull().default(true),
});

export type User = typeof users.$inferSelect;
export type PromiseRow = typeof promises.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type CriterionRow = typeof criteria.$inferSelect;
export type Funding = typeof fundings.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type LedgerEvent = typeof ledgerEvents.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

/* ─────────────── Agents, passports, notifications, channels ─────────────── */

/** Every model call (SPEC §8.2 logging, §24 agent run log). */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    agent: text("agent").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    status: text("status", { enum: ["ok", "error", "refusal"] }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    error: text("error"),
    output: jsonb("output"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_runs_subject_idx").on(t.subjectType, t.subjectId)],
);

/** Ahadi Passport (SPEC §15), recomputed after each settlement. */
export const passports = pgTable("passports", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  slug: text("slug").notNull().unique(),
  stats: jsonb("stats").notNull(),
  score: numeric("score", { precision: 4, scale: 3, mode: "number" }).notNull().default(0),
  showExactEarnings: boolean("show_exact_earnings").notNull().default(false),
  recomputedAt: timestamp("recomputed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** In-app inbox + delivery log for email / WhatsApp (SPEC §17 notify.send). */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    promiseId: uuid("promise_id"),
    template: text("template").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    channels: text("channels").array().notNull(),
    deliveries: jsonb("deliveries"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    phoneE164: text("phone_e164").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    body: text("body").notNull(),
    waMessageId: text("wa_message_id").unique(),
    action: jsonb("action"),
    createdAt: createdAt(),
  },
  (t) => [index("whatsapp_phone_idx").on(t.phoneE164, t.createdAt)],
);

/** Daily anchors of each promise's ledger head (SPEC §11.2). */
export const ledgerAnchors = pgTable(
  "ledger_anchors",
  {
    id: id(),
    promiseId: uuid("promise_id")
      .notNull()
      .references(() => promises.id),
    seq: integer("seq").notNull(),
    headHash: text("head_hash").notNull(),
    anchoredAt: timestamp("anchored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.promiseId, t.seq)],
);

/** Agent actions log for the agent settings page (SPEC §20). */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: id(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    tool: text("tool").notNull(),
    input: jsonb("input"),
    result: text("result", { enum: ["ok", "error"] }).notNull(),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_actions_agent_idx").on(t.agentId, t.createdAt)],
);

export type TermsVersion = typeof termsVersions.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Verification = typeof verifications.$inferSelect;
export type CriterionResultRow = typeof criterionResults.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Mediation = typeof mediations.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type Mandate = typeof mandates.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Passport = typeof passports.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
