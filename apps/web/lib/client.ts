"use client";

/** Small fetch helpers for client components: JSON in, typed JSON out, readable errors. */
export class ApiError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(
  url: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      json?.error?.code ?? "ERROR",
      json?.error?.message ?? `Request failed (${res.status})`,
      json?.error?.details,
    );
  return json as T;
}

/** Turn validation details ({path,message}[] or zod fieldErrors) into readable lines. */
export function detailLines(details: unknown): string[] {
  if (Array.isArray(details))
    return details.map((d) =>
      typeof d === "object" && d && "message" in d
        ? `${(d as { path?: string }).path ? `${(d as { path: string }).path}: ` : ""}${(d as { message: string }).message}`
        : String(d),
    );
  if (details && typeof details === "object" && "fieldErrors" in (details as object)) {
    return Object.entries((details as { fieldErrors: Record<string, string[]> }).fieldErrors).map(
      ([k, v]) => `${k}: ${v.join(", ")}`,
    );
  }
  return [];
}
