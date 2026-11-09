import { createHash, createHmac } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getEnv } from "@ahadi/core/env";
import { runWebResearch, kaziSystem, newNonce, PROMPTS, untrusted } from "@ahadi/agents";
import { agents, criteria, getDb, milestones, promises, termsVersions, users } from "@ahadi/db";
import { enqueue } from "@ahadi/queue";
import { logAgentAction } from "./agent-keys";
import { log } from "./log";
import { submitWork } from "./verification";

/**
 * Provider agent protocol (SPEC §14). Events are POSTed to the agent's webhook, signed with
 * X-Ahadi-Signature = hex HMAC-SHA256(key = sha256hex(agent API key), body). Built-in providers
 * use "internal:<name>" URLs and run as jobs inside Ahadi.
 */
export async function dispatchProviderEvent(
  promiseId: string,
  milestoneId: string,
  event: "job.funded" | "job.verdict" | "job.paid",
) {
  const db = getDb();
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  if (!p?.workerAgentId) return "no_provider_agent";
  const [agent] = await db.select().from(agents).where(eq(agents.id, p.workerAgentId));
  if (!agent?.providerWebhookUrl || agent.revokedAt) return "no_webhook";
  const [m] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  const [terms] = await db.select().from(termsVersions).where(eq(termsVersions.id, p.currentTermsVersionId!));
  const payload = {
    event,
    promiseId,
    milestone: m!.position,
    milestoneId,
    title: p.title,
    brief: p.sourceBrief,
    terms: terms?.body.milestones.find((x) => x.position === m!.position) ?? null,
    termsHash: terms?.bodyHash ?? null,
    state: m!.state,
    submitVia: "mcp:submit_work",
    mcpUrl: `${getEnv().APP_URL.replace(/\/$/, "")}/mcp`,
    sentAt: new Date().toISOString(),
  };

  if (agent.providerWebhookUrl.startsWith("internal:")) {
    if (agent.providerWebhookUrl === "internal:kazi" && event === "job.funded")
      await enqueue("kazi.run", { promiseId, milestoneId });
    await logAgentAction(agent.id, `webhook:${event}`, { promiseId, milestoneId }, "ok", {
      internal: agent.providerWebhookUrl,
    });
    return "internal";
  }
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", agent.apiKeyHash).update(body).digest("hex");
  const res = await fetch(agent.providerWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ahadi-Event": event,
      "X-Ahadi-Signature": signature,
      "User-Agent": "Ahadi-Webhooks/1.0",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  await logAgentAction(agent.id, `webhook:${event}`, { promiseId, milestoneId }, res.ok ? "ok" : "error", {
    status: res.status,
  });
  if (!res.ok) throw new Error(`Provider webhook returned ${res.status}`);
  return "delivered";
}

/** Helper for provider agents to verify our signature (documented in docs/MCP.md). */
export function expectedSignature(apiKey: string, body: string) {
  return createHmac("sha256", createHash("sha256").update(apiKey).digest("hex")).update(body).digest("hex");
}

/** Kazi Research Agent (AGENT_PROMPTS §12): research with web search, then submit_work as the provider. */
export async function runKazi(promiseId: string, milestoneId: string) {
  const db = getDb();
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  const [m] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!p || !m || m.state !== "FUNDED") return "not_funded";
  const [agent] = await db.select().from(agents).where(eq(agents.id, p.workerAgentId!));
  const [owner] = await db.select().from(users).where(eq(users.id, agent!.ownerId));
  const crit = await db
    .select()
    .from(criteria)
    .where(eq(criteria.milestoneId, milestoneId))
    .orderBy(asc(criteria.key));
  const nonce = newNonce();
  const { text } = await runWebResearch({
    meta: PROMPTS.kazi,
    system: kaziSystem({ nonce, criteriaJson: JSON.stringify(crit.map((c) => c.spec)) }),
    prompt: `Brief:\n${untrusted(nonce, "brief", "client", p.sourceBrief ?? p.title)}\n\nWrite the report now.`,
  });
  if (text.length < 200) throw new Error("Kazi produced an empty report");
  const actor = { kind: "agent" as const, agent: agent!, owner: owner! };
  const sub = await submitWork(actor, milestoneId, {
    kind: "text",
    text,
    note: "Submitted by Kazi Research Agent",
  });
  await logAgentAction(
    agent!.id,
    "submit_work",
    { promiseId, milestone: m.position, words: text.split(/\s+/).length },
    "ok",
    { submissionId: sub.id },
  );
  log.info({ promise_id: promiseId, submission_id: sub.id }, "kazi submitted report");
  return "submitted";
}
