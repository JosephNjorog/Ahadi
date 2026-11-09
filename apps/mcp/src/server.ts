import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError, CATEGORIES, bpsToPercent, formatMoney, isAppError } from "@ahadi/core";
import { getDb, milestones, promises, services } from "@ahadi/db";
import {
  assertMandate,
  authenticateAgentKey,
  createMilestoneOrder,
  createPromise,
  getPromiseDetail,
  getVerificationView,
  logAgentAction,
  mandateStatus,
  recordDecision,
  scoreForUser,
  searchProviders,
  submitWork,
  type Actor,
} from "@ahadi/services";

/**
 * Ahadi MCP server (SPEC §12). Stateless Streamable HTTP: one server + transport per request,
 * authenticated with `Authorization: Bearer <agent api key>`. Agents act only on promises where
 * they are a party; money moves only through PayPal approval and Ahadi's settlement service.
 */

type AgentActor = Extract<Actor, { kind: "agent" }>;

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
});

function toolError(e: unknown) {
  const body = isAppError(e)
    ? {
        code: e.code,
        message: e.message,
        ...(e.details && typeof e.details === "object" ? (e.details as object) : {}),
      }
    : { code: "INTERNAL", message: (e as Error).message ?? "Unexpected error" };
  return { ...text(body), isError: true };
}

async function milestoneByPosition(promiseId: string, position = 1) {
  const [m] = await getDb()
    .select()
    .from(milestones)
    .where(and(eq(milestones.promiseId, promiseId), eq(milestones.position, position)));
  if (!m) throw new AppError("NOT_FOUND", `Milestone ${position} not found (terms may not be signed yet)`);
  return m;
}

function wrap<A>(actor: AgentActor, tool: string, fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      const out = await fn(args);
      await logAgentAction(actor.agent.id, tool, args, "ok");
      return text(out);
    } catch (e) {
      await logAgentAction(actor.agent.id, tool, args, "error", { message: (e as Error).message });
      return toolError(e);
    }
  };
}

export function buildServer(actor: AgentActor) {
  const server = new McpServer(
    { name: "ahadi", version: "1.0.0" },
    {
      instructions:
        "Ahadi lets you hire people or agents with payment released only when work is verified against signed acceptance criteria. Your owner's spending mandate is enforced on every promise and funding. Funding needs your owner's approval in PayPal: give them the approvalUrl, then poll get_promise.",
    },
  );

  server.registerTool(
    "search_providers",
    {
      title: "Search providers",
      description:
        "Find people or agents offering a kind of work, ranked by verified track record (score 0–1) and price.",
      inputSchema: {
        category: z.enum(CATEGORIES),
        query: z.string().max(200).optional(),
        maxPriceUsd: z.number().positive().optional(),
        minScore: z.number().min(0).max(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(actor, "search_providers", (a) => searchProviders(a)),
  );

  server.registerTool(
    "create_promise",
    {
      title: "Create promise",
      description:
        "Create a verified-payment promise. Ahadi turns the brief into acceptance criteria; payment is released only when work is verified against them. Pass providerId (a serviceId from search_providers) to hire a marketplace provider, or workerEmail to invite a person.",
      inputSchema: {
        title: z.string().max(120),
        brief: z.string().max(8000),
        category: z.enum(CATEGORIES),
        budgetUsd: z.number().positive(),
        providerId: z.string().uuid().optional(),
        workerEmail: z.string().email().optional(),
        deadline: z.string().datetime().optional(),
      },
    },
    wrap(
      actor,
      "create_promise",
      async (a: {
        title: string;
        brief: string;
        category: (typeof CATEGORIES)[number];
        budgetUsd: number;
        providerId?: string;
        workerEmail?: string;
        deadline?: string;
      }) => {
        let providerScore: number | null = null;
        if (a.providerId) {
          const [s] = await getDb().select().from(services).where(eq(services.id, a.providerId));
          if (!s) throw new AppError("NOT_FOUND", "Provider service not found");
          providerScore = await scoreForUser(s.providerUserId);
        }
        await assertMandate(actor.agent.id, {
          amountMinor: Math.round(a.budgetUsd * 100),
          category: a.category,
          providerScore,
        });
        const p = await createPromise(
          actor,
          {
            title: a.title,
            brief: a.brief,
            category: a.category,
            budgetUsd: a.budgetUsd,
            serviceId: a.providerId,
            workerEmail: a.workerEmail,
            deadline: a.deadline,
          },
          { inline: true },
        );
        return summarize(await getPromiseDetail(actor, p.id));
      },
    ),
  );

  server.registerTool(
    "get_promise",
    {
      title: "Get promise",
      description:
        "Status, signed terms, milestones, funding and the latest verdict for a promise you are party to.",
      inputSchema: { promiseId: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    wrap(actor, "get_promise", async (a: { promiseId: string }) =>
      summarize(await getPromiseDetail(actor, a.promiseId)),
    ),
  );

  server.registerTool(
    "fund_promise",
    {
      title: "Fund promise",
      description:
        "Secure funds for a milestone. Checks your mandate, creates a PayPal authorization order and returns an approvalUrl your owner must open to approve the hold. Money is captured only after verification.",
      inputSchema: { promiseId: z.string().uuid(), milestone: z.number().int().min(1).optional() },
    },
    wrap(actor, "fund_promise", async (a: { promiseId: string; milestone?: number }) => {
      const m = await milestoneByPosition(a.promiseId, a.milestone ?? 1);
      const [p] = await getDb().select().from(promises).where(eq(promises.id, a.promiseId));
      const { ownerApprovalRequired } = await assertMandate(actor.agent.id, {
        amountMinor: m.amountMinor,
        category: p!.category,
        providerScore: p!.workerUserId ? await scoreForUser(p!.workerUserId) : null,
      });
      const { orderId, approvalUrl } = await createMilestoneOrder(actor, m.id);
      return {
        status: "approval_required",
        orderId,
        approvalUrl,
        ownerApprovalRequired: true,
        aboveOwnerThreshold: ownerApprovalRequired,
        amount: formatMoney(m.amountMinor, p!.currency),
        next: "Send approvalUrl to your owner. After they approve in PayPal, get_promise shows the milestone as FUNDED.",
      };
    }),
  );

  server.registerTool(
    "submit_work",
    {
      title: "Submit work",
      description:
        "For provider agents: submit a deliverable for a funded milestone. kind is url, repo (with repoUrl and commitSha) or text.",
      inputSchema: {
        promiseId: z.string().uuid(),
        milestone: z.number().int().min(1),
        kind: z.enum(["url", "repo", "text"]),
        url: z.string().url().optional(),
        repoUrl: z.string().url().optional(),
        commitSha: z.string().optional(),
        text: z.string().max(200_000).optional(),
      },
    },
    wrap(
      actor,
      "submit_work",
      async (a: {
        promiseId: string;
        milestone: number;
        kind: "url" | "repo" | "text";
        url?: string;
        repoUrl?: string;
        commitSha?: string;
        text?: string;
      }) => {
        const m = await milestoneByPosition(a.promiseId, a.milestone);
        const s = await submitWork(actor, m.id, {
          kind: a.kind,
          url: a.url,
          repoUrl: a.repoUrl,
          commitSha: a.commitSha,
          text: a.text,
        });
        return { submissionId: s.id, attempt: s.attempt, status: "VERIFYING" };
      },
    ),
  );

  server.registerTool(
    "get_verdict",
    {
      title: "Get verdict",
      description: "Per-criterion verification results, the computed release proposal and its explanation.",
      inputSchema: { promiseId: z.string().uuid(), milestone: z.number().int().min(1) },
      annotations: { readOnlyHint: true },
    },
    wrap(actor, "get_verdict", async (a: { promiseId: string; milestone: number }) => {
      const m = await milestoneByPosition(a.promiseId, a.milestone);
      const v = await getVerificationView(actor, m.id);
      return {
        milestoneState: v.milestone.state,
        verification: v.verification
          ? {
              status: v.verification.status,
              stage: v.verification.stage,
              injectionFlagged: v.verification.injectionFlagged,
              summary: v.verification.summary,
            }
          : null,
        criteria: v.criteria.map((c) => ({
          id: c.key,
          title: c.spec.title,
          weight: c.weight,
          required: c.required,
          outcome: c.result?.outcome ?? "pending",
          credit: c.result?.credit,
          confidence: c.result?.confidence,
          reasoning: c.result?.reasoning,
        })),
        proposal: v.proposal
          ? {
              release: bpsToPercent(v.proposal.releaseBps),
              capture: formatMoney(v.proposal.captureMinor, v.promise.currency),
              platformFee: formatMoney(v.proposal.platformFeeMinor, v.promise.currency),
              windowEndsAt: v.proposal.windowEndsAt,
              clientDecision: v.proposal.clientDecision,
              workerDecision: v.proposal.workerDecision,
              explanation: v.proposal.explanation,
            }
          : null,
      };
    }),
  );

  server.registerTool(
    "release",
    {
      title: "Release decision",
      description:
        "Record your decision on the proposed release: accept, or object (opens mediation). Settlement itself runs in Ahadi's settlement service.",
      inputSchema: {
        promiseId: z.string().uuid(),
        milestone: z.number().int().min(1),
        decision: z.enum(["accept", "object"]),
        reason: z.string().max(4000).optional(),
      },
    },
    wrap(
      actor,
      "release",
      async (a: { promiseId: string; milestone: number; decision: "accept" | "object"; reason?: string }) => {
        const m = await milestoneByPosition(a.promiseId, a.milestone);
        return recordDecision(actor, m.id, { decision: a.decision, reason: a.reason });
      },
    ),
  );

  server.registerTool(
    "dispute",
    {
      title: "Dispute",
      description: "Object to a proposal with a statement; opens mediation. Funds stay held by PayPal.",
      inputSchema: {
        promiseId: z.string().uuid(),
        milestone: z.number().int().min(1),
        statement: z.string().min(10).max(4000),
      },
    },
    wrap(actor, "dispute", async (a: { promiseId: string; milestone: number; statement: string }) => {
      const m = await milestoneByPosition(a.promiseId, a.milestone);
      return recordDecision(actor, m.id, { decision: "object", reason: a.statement });
    }),
  );

  server.registerTool(
    "get_mandate",
    {
      title: "Get mandate",
      description: "Your owner's spending rules and remaining per-job and monthly budget.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(actor, "get_mandate", () => mandateStatus(actor.agent.id)),
  );

  return server;
}

function summarize(d: Awaited<ReturnType<typeof getPromiseDetail>>) {
  return {
    promiseId: d.promise.id,
    title: d.promise.title,
    status: d.promise.state,
    termsStatus: d.promise.termsStatus,
    termsError: d.promise.termsError,
    yourRole: d.role,
    termsVersion: d.terms?.version ?? null,
    termsHash: d.terms?.bodyHash ?? null,
    signatures: d.signatures.map((s) => s.party),
    criteria:
      d.terms?.body.milestones.flatMap((m) =>
        m.criteria.map((c) => ({
          milestone: m.position,
          id: c.id,
          title: c.title,
          weight: c.weight,
          required: c.required,
          method: c.method,
        })),
      ) ?? [],
    milestones: d.milestones.map((m) => ({
      position: m.position,
      title: m.title,
      amount: formatMoney(m.amountMinor, d.promise.currency),
      state: m.state,
      funding: m.funding?.status ?? null,
      latestVerdict: m.proposal
        ? {
            release: bpsToPercent(m.proposal.releaseBps),
            capture: formatMoney(m.proposal.captureMinor, d.promise.currency),
          }
        : null,
    })),
  };
}

/** Web-standard handler used by the Next.js route (/mcp) and the standalone server. */
export async function handleMcpRequest(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  const actor = await authenticateAgentKey(key);
  if (!actor) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Invalid or revoked Ahadi agent key (Authorization: Bearer ahk_…)" },
        id: null,
      }),
      {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="ahadi"' },
      },
    );
  }
  const server = buildServer(actor);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
