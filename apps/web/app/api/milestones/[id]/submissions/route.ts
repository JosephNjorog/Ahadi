import { NextResponse } from "next/server";
import { MAX_FILE_BYTES, submitWork } from "@ahadi/services";
import { withUser } from "@/lib/api";
import { readFiles } from "@/lib/upload";

export const runtime = "nodejs";

/** SPEC §16: JSON for url/repo/text, multipart for files. */
export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = await readFiles(form, "files", { maxFiles: 10, maxBytes: MAX_FILE_BYTES });
    const s = await submitWork(
      actor,
      params.id,
      { kind: "files", note: String(form.get("note") ?? "") || undefined },
      files,
    );
    return NextResponse.json({ submissionId: s.id, attempt: s.attempt }, { status: 201 });
  }
  const s = await submitWork(actor, params.id, await req.json().catch(() => ({})));
  return NextResponse.json({ submissionId: s.id, attempt: s.attempt }, { status: 201 });
});
