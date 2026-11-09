import { NextResponse } from "next/server";
import { z } from "zod";
import { submitManualVerdict } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  note: z.string().trim().min(3).max(1000),
  results: z
    .array(
      z.object({
        criterionKey: z.string().regex(/^c\d+$/),
        outcome: z.enum(["pass", "partial", "fail"]),
        credit: z.number().min(0).max(1).optional(),
        reasoning: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(8),
});

export const POST = withUser<{ id: string }>(
  async ({ req, actor, params }) => {
    const body = await readJson(req, Body);
    const { proposal, computed } = await submitManualVerdict(actor, { milestoneId: params.id, ...body });
    return NextResponse.json({ proposalId: proposal.id, releaseBps: computed.releaseBps, captureMinor: computed.captureMinor, kind: computed.kind });
  },
  { admin: true },
);
