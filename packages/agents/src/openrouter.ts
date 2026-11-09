import { z } from "zod";
import { AppError } from "@ahadi/core";
import type { PromptMeta } from "./prompts";

/**
 * OpenRouter provider (OpenAI-compatible Chat Completions). Used when OPENROUTER_API_KEY is set
 * (or AI_PROVIDER=openrouter). Models are configured with OPENROUTER_MODEL_ARCHITECT / _VERIFIER / _FAST.
 */

const URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Defaults are free models (no OpenRouter credits needed) that support structured outputs, tools
 * and images. With credits, set e.g. OPENROUTER_MODEL_ARCHITECT=anthropic/claude-sonnet-4.5 or openai/gpt-4o.
 */
const DEFAULT_MODELS: Record<PromptMeta["modelEnv"], string> = {
  MODEL_ARCHITECT: "nvidia/nemotron-3.5-super-vl:free",
  MODEL_VERIFIER: "nvidia/nemotron-3.5-super-vl:free",
  MODEL_FAST: "nvidia/nemotron-3.5-super-vl:free",
};

/** Tried by OpenRouter when the primary model is rate-limited or down. Comma-separated override: OPENROUTER_FALLBACK_MODELS. */
export function openrouterFallbacks(primary: string): string[] {
  const list = (process.env.OPENROUTER_FALLBACK_MODELS ?? "google/gemma-4-31b-it:free")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.filter((m) => m !== primary);
}

/** Output-token cap per request (keeps requests affordable on low balances). */
export function openrouterMaxTokens(requested: number): number {
  return Math.min(requested, Number(process.env.OPENROUTER_MAX_TOKENS ?? 8000));
}

export function openrouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function openrouterModelFor(meta: PromptMeta): string {
  return process.env[`OPENROUTER_${meta.modelEnv}`] || DEFAULT_MODELS[meta.modelEnv];
}

export type ORPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ORMessage =
  | { role: "system" | "user"; content: string | ORPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ORToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ORToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ORResponse {
  model: string;
  choices: {
    finish_reason: string | null;
    message: { content: string | null; tool_calls?: ORToolCall[]; refusal?: string | null };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: number };
}

/** POST with retries on 408/429/5xx and network errors (3 attempts, exponential backoff). */
export async function orChat(input: Record<string, unknown>): Promise<ORResponse> {
  const primary = String(input.model);
  const fallbacks = openrouterFallbacks(primary);
  const body = {
    ...input,
    max_tokens: openrouterMaxTokens(Number(input.max_tokens ?? 8000)),
    ...(fallbacks.length ? { models: [primary, ...fallbacks] } : {}),
  };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key)
    throw new AppError(
      "CONFIG_MISSING",
      "OPENROUTER_API_KEY is not set. AI features need it (docs/SETUP.md).",
    );
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "https://ahadi-web.onrender.com",
          "X-Title": "Ahadi",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const json = (await res.json().catch(() => ({}))) as ORResponse;
      if (res.ok && !json.error) return json;
      last = `${res.status} ${json.error?.message ?? res.statusText}`;
      if (!(res.status === 408 || res.status === 429 || res.status >= 500)) break;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
  throw new AppError("INTERNAL", `OpenRouter request failed: ${last}`);
}

/** JSON Schema for the response_format, from the Zod schema. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** Models sometimes wrap JSON in prose or code fences; take the outermost object. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("Response was not JSON");
  }
}
