import { NextResponse } from "next/server";
import { z } from "zod";
import { askOpsAgent } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(40),
});

export const POST = withUser(
  async ({ req, actor }) => {
    const { messages } = await readJson(req, Body);
    return NextResponse.json(await askOpsAgent(actor, messages));
  },
  { admin: true },
);
