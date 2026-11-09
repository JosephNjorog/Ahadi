import "server-only";
import { AppError } from "@ahadi/core";
import type { UploadedFile } from "@ahadi/services";

/** Read multipart file fields into memory with size limits (submissions, voice briefs). */
export async function readFiles(
  form: FormData,
  field: string,
  opts: { maxFiles: number; maxBytes: number; accept?: RegExp },
): Promise<UploadedFile[]> {
  const files = form.getAll(field).filter((f): f is File => typeof f !== "string");
  if (files.length > opts.maxFiles) throw new AppError("VALIDATION_FAILED", `At most ${opts.maxFiles} files`);
  const out: UploadedFile[] = [];
  for (const f of files) {
    if (f.size > opts.maxBytes)
      throw new AppError(
        "VALIDATION_FAILED",
        `${f.name} is larger than ${Math.round(opts.maxBytes / 1024 / 1024)} MB`,
      );
    if (opts.accept && !opts.accept.test(f.type || f.name))
      throw new AppError("VALIDATION_FAILED", `${f.name}: unsupported file type`);
    out.push({
      name: f.name.slice(0, 200),
      mime: f.type || "application/octet-stream",
      data: Buffer.from(await f.arrayBuffer()),
    });
  }
  return out;
}
