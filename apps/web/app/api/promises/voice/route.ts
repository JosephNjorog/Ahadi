import { NextResponse } from "next/server";
import { AppError } from "@ahadi/core";
import { transcribe } from "@ahadi/services";
import { withUser } from "@/lib/api";
import { readFiles } from "@/lib/upload";

export const runtime = "nodejs";

/** SPEC §16: voice note (English/Swahili) → transcript. The client reviews it before creating the promise. */
export const POST = withUser(async ({ req }) => {
  const form = await req.formData();
  const [audio] = await readFiles(form, "audio", {
    maxFiles: 1,
    maxBytes: 24 * 1024 * 1024,
    accept: /audio|webm|ogg|mp4|mpeg|wav|m4a/i,
  });
  if (!audio) throw new AppError("VALIDATION_FAILED", "Attach a voice note");
  const lang = form.get("language");
  const transcript = await transcribe(
    audio.data,
    audio.mime,
    lang === "sw" || lang === "en" ? lang : undefined,
  );
  if (!transcript) throw new AppError("VALIDATION_FAILED", "We couldn't hear any words in that recording");
  return NextResponse.json({ transcript });
});
