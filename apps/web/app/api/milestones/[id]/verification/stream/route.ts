import type { NextRequest } from "next/server";
import { AppError } from "@ahadi/core";
import { getVerificationView } from "@ahadi/services";
import { errorResponse } from "@/lib/api";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SPEC §16 SSE: live criterion results for the verification screen. Polls the database once a
 * second and emits a snapshot whenever anything changes; closes when the verdict is settled.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return errorResponse(new AppError("UNAUTHENTICATED", "Please sign in"));
  const { id } = await ctx.params;
  const actor = { kind: "user" as const, user };
  try {
    await getVerificationView(actor, id);
  } catch (e) {
    return errorResponse(e);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      let ticks = 0;
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      while (!req.signal.aborted && ticks < 900) {
        try {
          const view = await getVerificationView(actor, id);
          const key = JSON.stringify([
            view.milestone.state,
            view.verification?.stage,
            view.verification?.status,
            view.criteria.map((c) => c.result?.outcome ?? null),
            view.proposal?.id,
            view.proposal?.clientDecision,
            view.proposal?.workerDecision,
            view.proposal?.explanationClient != null,
          ]);
          if (key !== last) {
            last = key;
            send("snapshot", view);
          } else if (ticks % 15 === 0) controller.enqueue(encoder.encode(": keep-alive\n\n"));
          if (["SETTLED", "VOIDED", "ESCALATED", "FUNDED"].includes(view.milestone.state) && ticks > 2) break;
        } catch (e) {
          send("error", { message: (e as Error).message });
          break;
        }
        ticks++;
        await new Promise((r) => setTimeout(r, 1000));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
