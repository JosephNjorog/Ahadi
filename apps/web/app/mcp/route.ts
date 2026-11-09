import type { NextRequest } from "next/server";
import { handleMcpRequest } from "@ahadi/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ahadi MCP server (SPEC §12) at /mcp — Streamable HTTP, Bearer agent key. */
export async function POST(req: NextRequest) {
  return handleMcpRequest(req);
}
export async function GET(req: NextRequest) {
  return handleMcpRequest(req);
}
export async function DELETE(req: NextRequest) {
  return handleMcpRequest(req);
}
