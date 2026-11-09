import sharp from "sharp";
import { emptyResult, type CollectorResult } from "./types";

/** SPEC §9.3 design collector. Images (PNG/JPG/WebP/SVG/GIF) uploaded as deliverable artifacts. */

export interface ImageFacts {
  key: string;
  fileName: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  palette: string[];
}

export interface DesignSummary {
  images: ImageFacts[];
  skipped: { fileName: string; reason: string }[];
}

/** Dominant colours by coarse quantisation (32 levels/channel) of a 64×64 thumbnail. */
export async function palette(buf: Buffer, n = 6): Promise<string[]> {
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    const q = (v: number) => Math.min(255, Math.round(v / 32) * 32);
    const hex = `#${[data[i]!, data[i + 1]!, data[i + 2]!].map((v) => q(v).toString(16).padStart(2, "0")).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([h]) => h);
}

export async function collectDesign(
  files: { key: string; fileName: string; mime: string; data: Buffer }[],
  references: { key: string; fileName: string; data: Buffer }[] = [],
): Promise<CollectorResult> {
  const result = emptyResult();
  const summary: DesignSummary = { images: [], skipped: [] };
  for (const f of files) {
    if (!/^image\//.test(f.mime)) {
      summary.skipped.push({
        fileName: f.fileName,
        reason: `${f.mime} is not an image; export PDFs/Figma frames as PNG`,
      });
      continue;
    }
    try {
      const img = sharp(f.data, { density: 144 });
      const meta = await img.metadata();
      const facts: ImageFacts = {
        key: f.key,
        fileName: f.fileName,
        format: meta.format ?? f.mime,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        bytes: f.data.length,
        palette: await palette(f.data),
      };
      summary.images.push(facts);
      // A downscaled PNG for the vision model (long edge ≤ 1568px).
      const preview = await sharp(f.data, { density: 144 })
        .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      const key = `preview_${f.key}`;
      result.artifacts.push({
        key,
        role: "evidence",
        kind: "screenshot",
        mime: "image/png",
        data: preview,
        label: `Preview of ${f.fileName} (${facts.width}×${facts.height})`,
        meta: { ...facts },
      });
      result.imageKeys.push(key);
      if (f.mime === "image/svg+xml")
        result.scanTargets.push({ content: f.data.toString("utf8"), location: f.fileName, format: "html" });
      const exif = meta.exif
        ?.toString("latin1")
        .replace(/[^\x20-\x7e]+/g, " ")
        .trim();
      if (exif) result.scanTargets.push({ content: exif, location: `${f.fileName} EXIF`, format: "text" });
    } catch (e) {
      summary.skipped.push({ fileName: f.fileName, reason: `Could not read image: ${(e as Error).message}` });
    }
  }
  for (const r of references) {
    const preview = await sharp(r.data)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer()
      .catch(() => null);
    if (!preview) continue;
    const key = `reference_${r.key}`;
    result.artifacts.push({
      key,
      role: "evidence",
      kind: "screenshot",
      mime: "image/png",
      data: preview,
      label: `Client reference image ${r.fileName}`,
    });
    result.imageKeys.push(key);
  }
  result.artifacts.push({
    key: "design_report",
    role: "evidence",
    kind: "report",
    mime: "application/json",
    data: Buffer.from(JSON.stringify(summary)),
    label: "Design evidence report",
  });
  result.summary = summary as unknown as Record<string, unknown>;
  return result;
}
