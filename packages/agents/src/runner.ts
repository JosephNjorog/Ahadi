import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AppError } from "@ahadi/core";
import type { PromptMeta } from "./prompts";
import {
  extractJson,
  jsonSchemaFor,
  openrouterConfigured,
  openrouterModelFor,
  orChat,
  type ORMessage,
  type ORPart,
} from "./openrouter";

export type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export interface AgentRunRecord {
  agent: string;
  promptVersion: string;
  model: string;
  subjectType?: string;
  subjectId?: string;
  status: "ok" | "error" | "refusal";
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  error?: string;
  output?: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

let recorder: ((r: AgentRunRecord) => Promise<void>) | undefined;
/** Services install a recorder that writes agent_runs rows. */
export function setAgentRunRecorder(fn: typeof recorder) {
  recorder = fn;
}

let injectedClient: Anthropic | undefined;
let defaultClient: Anthropic | undefined;
/** Tests inject a client with a fake fetch. */
export function setAnthropicClient(c: Anthropic | undefined) {
  injectedClient = c;
}
export function getAnthropic(): Anthropic {
  if (injectedClient) return injectedClient;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "CONFIG_MISSING",
      "ANTHROPIC_API_KEY is not set. AI features need it (docs/SETUP.md).",
    );
  }
  defaultClient ??= new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  return defaultClient;
}

/** Which model provider runs the agents. Tests inject an Anthropic client; otherwise OpenRouter wins if configured. */
export function aiProvider(): "anthropic" | "openrouter" | null {
  if (injectedClient) return "anthropic";
  const pref = process.env.AI_PROVIDER;
  if (pref === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (openrouterConfigured()) return "openrouter";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

/** True when any AI provider is configured (name kept for existing callers). */
export function anthropicConfigured(): boolean {
  return aiProvider() !== null;
}
export const aiConfigured = anthropicConfigured;

const DEFAULT_MODELS: Record<PromptMeta["modelEnv"], string> = {
  MODEL_ARCHITECT: "claude-opus-5-5",
  MODEL_VERIFIER: "claude-sonnet-5-5",
  MODEL_FAST: "claude-haiku-5-5",
};

export function modelFor(meta: PromptMeta): string {
  if (aiProvider() === "openrouter") return openrouterModelFor(meta);
  return process.env[meta.modelEnv] || DEFAULT_MODELS[meta.modelEnv];
}

function toORParts(blocks: ContentBlock[]): ORPart[] {
  const out: ORPart[] = [];
  for (const b of blocks) {
    if (b.type === "text") out.push({ type: "text", text: b.text });
    else if (b.type === "image" && b.source.type === "base64")
      out.push({
        type: "image_url",
        image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
      });
  }
  return out;
}

function orUsage(
  u:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      }
    | undefined,
): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

async function runStructuredOpenRouter<T>(opts: StructuredRunOptions<T>): Promise<StructuredRunResult<T>> {
  const model = modelFor(opts.meta);
  const maxAttempts = (opts.retries ?? 2) + 1;
  const started = Date.now();
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const schema = jsonSchemaFor(opts.schema);
  const messages: ORMessage[] = [
    {
      role: "system",
      content: `${opts.system}\n\nRespond with a single JSON object that matches the required schema. No prose outside the JSON.`,
    },
    { role: "user", content: toORParts(opts.content) },
  ];
  let lastError = "";
  const record = (r: Partial<AgentRunRecord> & Pick<AgentRunRecord, "status" | "attempts">) =>
    recorder?.({
      agent: opts.meta.agent,
      promptVersion: opts.meta.version,
      model,
      subjectType: opts.subject?.type,
      subjectId: opts.subject?.id,
      latencyMs: Date.now() - started,
      ...usage,
      ...r,
    }).catch(() => undefined);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await orChat({
      model,
      messages,
      max_tokens: opts.meta.maxTokens,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.meta.agent.replace(/[^a-zA-Z0-9_-]/g, "_"), strict: false, schema },
      },
      provider: { require_parameters: true },
    });
    usage = addUsage(usage, orUsage(res.usage));
    const choice = res.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (choice?.message?.refusal) {
      await record({ status: "refusal", attempts: attempt, error: choice.message.refusal });
      throw new AgentRefusalError(opts.meta.agent, choice.message.refusal);
    }
    messages.push({ role: "assistant", content: text });
    let parsed: T | null = null;
    try {
      const r = opts.schema.safeParse(extractJson(text));
      if (r.success) parsed = r.data;
      else
        lastError = `The JSON did not match the schema: ${r.error.issues
          .slice(0, 8)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`;
    } catch (e) {
      lastError =
        choice?.finish_reason === "length"
          ? "Output was cut off. Be more concise."
          : `Output was not valid JSON (${(e as Error).message}).`;
    }
    if (parsed) {
      const problems = opts.validate?.(parsed) ?? [];
      if (problems.length === 0) {
        await record({ status: "ok", attempts: attempt, output: parsed });
        return {
          output: parsed,
          usage,
          model: res.model ?? model,
          promptVersion: opts.meta.version,
          attempts: attempt,
          latencyMs: Date.now() - started,
        };
      }
      lastError = `Your previous output was rejected by validation:\n- ${problems.join("\n- ")}\nReturn a corrected output that fixes every point.`;
    }
    messages.push({ role: "user", content: `${lastError}\nReturn the complete corrected JSON object.` });
  }
  await record({ status: "error", attempts: maxAttempts, error: lastError });
  throw new AppError("INTERNAL", `${opts.meta.agent} could not produce valid output: ${lastError}`);
}

/** Server-side refusal fallback is available on the Opus/Sonnet/Fable 5.x line (not Haiku). */
function fallbackParams(model: string) {
  return /^claude-(opus|sonnet|fable)-5/.test(model)
    ? {
        betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
        fallbacks: "default" as const,
      }
    : { betas: [] as Anthropic.Beta.AnthropicBeta[] };
}

export class AgentRefusalError extends AppError {
  constructor(agent: string, category: string | null | undefined) {
    super("INTERNAL", `${agent} declined to answer${category ? ` (${category})` : ""}`, { agent, category });
    this.name = "AgentRefusalError";
  }
}

function usageOf(u: Anthropic.Beta.BetaUsage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export interface StructuredRunOptions<T> {
  meta: PromptMeta;
  system: string;
  content: ContentBlock[];
  schema: z.ZodType<T>;
  /** Extra code-level validation; return messages to reject the output and retry (AGENT_PROMPTS post-validation). */
  validate?: (output: T) => string[];
  retries?: number;
  subject?: { type: string; id: string };
  /** Override the effort from the prompt header. */
  effort?: "low" | "medium" | "high" | "xhigh";
}

export interface StructuredRunResult<T> {
  output: T;
  usage: Usage;
  model: string;
  promptVersion: string;
  attempts: number;
  latencyMs: number;
}

/**
 * Structured output via output_config.format (forced tool_choice is not available on the
 * current Opus/Sonnet models). The SDK validates against the Zod schema; code validation runs
 * on top, and failures are fed back to the model for one more try (SPEC §8.2).
 */
export async function runStructured<T>(opts: StructuredRunOptions<T>): Promise<StructuredRunResult<T>> {
  if (aiProvider() === "openrouter") return runStructuredOpenRouter(opts);
  const client = getAnthropic();
  const model = modelFor(opts.meta);
  const maxAttempts = (opts.retries ?? 2) + 1;
  const started = Date.now();
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const content: ContentBlock[] = [...opts.content];
  let lastError = "";
  const record = async (
    r: Omit<
      AgentRunRecord,
      "agent" | "promptVersion" | "model" | "latencyMs" | "inputTokens" | "outputTokens" | "cacheReadTokens"
    >,
  ) =>
    recorder?.({
      agent: opts.meta.agent,
      promptVersion: opts.meta.version,
      model,
      subjectType: opts.subject?.type,
      subjectId: opts.subject?.id,
      latencyMs: Date.now() - started,
      ...usage,
      ...r,
    }).catch(() => undefined);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { betas, ...fb } = fallbackParams(model);
    const res = await client.beta.messages.parse({
      model,
      max_tokens: opts.meta.maxTokens,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { effort: opts.effort ?? opts.meta.effort, format: betaZodOutputFormat(opts.schema) },
      ...(betas.length ? { betas } : {}),
      ...fb,
    });
    usage = addUsage(usage, usageOf(res.usage));

    if (res.stop_reason === "refusal") {
      await record({ status: "refusal", attempts: attempt, error: res.stop_details?.category ?? "refusal" });
      throw new AgentRefusalError(opts.meta.agent, res.stop_details?.category);
    }
    const parsed = res.parsed_output as T | null;
    if (res.stop_reason === "max_tokens" || !parsed) {
      lastError =
        res.stop_reason === "max_tokens"
          ? "Output was cut off. Be more concise."
          : "Output did not match the required schema.";
    } else {
      const problems = opts.validate?.(parsed) ?? [];
      if (problems.length === 0) {
        const latencyMs = Date.now() - started;
        await record({ status: "ok", attempts: attempt, output: parsed });
        return {
          output: parsed,
          usage,
          model,
          promptVersion: opts.meta.version,
          attempts: attempt,
          latencyMs,
        };
      }
      lastError = `Your previous output was rejected by validation:\n- ${problems.join("\n- ")}\nReturn a corrected output that fixes every point.`;
    }
    content.push({ type: "text", text: lastError });
  }
  await record({ status: "error", attempts: maxAttempts, error: lastError });
  throw new AppError("INTERNAL", `${opts.meta.agent} could not produce valid output: ${lastError}`);
}

/* ─────────────── Custom-tool loop (Ops Agent) ─────────────── */

export interface LoopTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

export async function runToolLoop(opts: {
  meta: PromptMeta;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: LoopTool[];
  maxTurns?: number;
}): Promise<{
  text: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  usage: Usage;
  toolCalls: { name: string; input: unknown; ok: boolean }[];
}> {
  if (aiProvider() === "openrouter") return runToolLoopOpenRouter(opts);
  const client = getAnthropic();
  const model = modelFor(opts.meta);
  const messages = [...opts.messages];
  const toolCalls: { name: string; input: unknown; ok: boolean }[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const started = Date.now();
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const { betas, ...fb } = fallbackParams(model);

  for (let turn = 0; turn < (opts.maxTurns ?? 12); turn++) {
    const res = await client.beta.messages
      .stream({
        model,
        max_tokens: opts.meta.maxTokens,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        tools: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
          strict: true,
        })),
        tool_choice: { type: "auto" },
        output_config: { effort: opts.meta.effort },
        messages,
        ...(betas.length ? { betas } : {}),
        ...fb,
      })
      .finalMessage();
    usage = addUsage(usage, usageOf(res.usage));
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (res.stop_reason === "refusal")
      throw new AgentRefusalError(opts.meta.agent, res.stop_details?.category);
    if (res.stop_reason === "pause_turn") continue;
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      await recorder?.({
        agent: opts.meta.agent,
        promptVersion: opts.meta.version,
        model,
        status: "ok",
        attempts: turn + 1,
        latencyMs: Date.now() - started,
        ...usage,
        output: { toolCalls },
      }).catch(() => undefined);
      return { text, messages, usage, toolCalls };
    }
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = byName.get(u.name);
        try {
          if (!tool) throw new Error(`Unknown tool ${u.name}`);
          const out = await tool.run(u.input as Record<string, unknown>);
          toolCalls.push({ name: u.name, input: u.input, ok: true });
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60_000) };
        } catch (e) {
          toolCalls.push({ name: u.name, input: u.input, ok: false });
          return {
            type: "tool_result",
            tool_use_id: u.id,
            content: `Error: ${(e as Error).message}`,
            is_error: true,
          };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  throw new AppError("INTERNAL", `${opts.meta.agent} exceeded its turn limit`);
}

async function runToolLoopOpenRouter(opts: {
  meta: PromptMeta;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: LoopTool[];
  maxTurns?: number;
}) {
  const model = modelFor(opts.meta);
  const started = Date.now();
  const toolCalls: { name: string; input: unknown; ok: boolean }[] = [];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const messages: ORMessage[] = [
    { role: "system", content: opts.system },
    ...opts.messages.map((m): ORMessage =>
      m.role === "assistant"
        ? { role: "assistant", content: typeof m.content === "string" ? m.content : "" }
        : { role: "user", content: typeof m.content === "string" ? m.content : "" },
    ),
  ];
  for (let turn = 0; turn < (opts.maxTurns ?? 12); turn++) {
    const res = await orChat({
      model,
      messages,
      max_tokens: opts.meta.maxTokens,
      temperature: 0,
      tools: opts.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      tool_choice: "auto",
    });
    usage = addUsage(usage, orUsage(res.usage));
    const msg = res.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    messages.push({
      role: "assistant",
      content: msg?.content ?? null,
      ...(calls.length ? { tool_calls: calls } : {}),
    });
    if (!calls.length) {
      await recorder?.({
        agent: opts.meta.agent,
        promptVersion: opts.meta.version,
        model,
        status: "ok",
        attempts: turn + 1,
        latencyMs: Date.now() - started,
        ...usage,
        output: { toolCalls },
      }).catch(() => undefined);
      return { text: msg?.content ?? "", messages: opts.messages, usage, toolCalls };
    }
    for (const c of calls) {
      const tool = byName.get(c.function.name);
      let content: string;
      try {
        if (!tool) throw new Error(`Unknown tool ${c.function.name}`);
        const input = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
        content = JSON.stringify(await tool.run(input)).slice(0, 60_000);
        toolCalls.push({ name: c.function.name, input, ok: true });
      } catch (e) {
        content = `Error: ${(e as Error).message}`;
        toolCalls.push({ name: c.function.name, input: c.function.arguments, ok: false });
      }
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
  }
  throw new AppError("INTERNAL", `${opts.meta.agent} exceeded its turn limit`);
}

/* ─────────────── Web research (Kazi) ─────────────── */

export async function runWebResearch(opts: {
  meta: PromptMeta;
  system: string;
  prompt: string;
  maxSearches?: number;
}) {
  const client = getAnthropic();
  const model = modelFor(opts.meta);
  const started = Date.now();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const { betas, ...fb } = fallbackParams(model);
  for (let turn = 0; turn < 8; turn++) {
    const res = await client.beta.messages
      .stream({
        model,
        max_tokens: opts.meta.maxTokens,
        system: opts.system,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 12 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 20 },
        ],
        output_config: { effort: opts.meta.effort },
        messages,
        ...(betas.length ? { betas } : {}),
        ...fb,
      })
      .finalMessage();
    usage = addUsage(usage, usageOf(res.usage));
    if (res.stop_reason === "refusal")
      throw new AgentRefusalError(opts.meta.agent, res.stop_details?.category);
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    await recorder?.({
      agent: opts.meta.agent,
      promptVersion: opts.meta.version,
      model,
      status: "ok",
      attempts: turn + 1,
      latencyMs: Date.now() - started,
      ...usage,
    }).catch(() => undefined);
    return { text, usage };
  }
  throw new AppError("INTERNAL", "Research did not finish");
}
