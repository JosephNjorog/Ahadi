import { desc } from "drizzle-orm";
import { setAgentRunRecorder } from "@ahadi/agents";
import { agentRuns, getDb } from "@ahadi/db";

/** Persist every model call (SPEC §8.2 logging, §24 agent run log). Installed when services load. */
setAgentRunRecorder(async (r) => {
  await getDb()
    .insert(agentRuns)
    .values({
      agent: r.agent,
      promptVersion: r.promptVersion,
      model: r.model,
      subjectType: r.subjectType ?? null,
      subjectId: r.subjectId ?? null,
      status: r.status,
      attempts: r.attempts,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      latencyMs: r.latencyMs,
      error: r.error ?? null,
      output: (r.output ?? null) as Record<string, unknown> | null,
    });
});

export async function recentAgentRuns(limit = 100) {
  return getDb().select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(limit);
}
