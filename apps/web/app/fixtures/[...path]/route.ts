import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const ROOT = path.resolve(process.cwd(), "../../fixtures");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".csv": "text/csv",
};

/** Serves demo deliverables (fixtures/) so the worker can submit e.g. /fixtures/bakery-site-v1/. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path;
  let rel = parts.join("/");
  if (!path.extname(rel)) rel = `${rel.replace(/\/$/, "")}/index.html`;
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/** The bakery fixtures' contact form posts here. */
export async function POST() {
  return new Response("Thanks! Mama Njeri's Bakery will call you back.", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
