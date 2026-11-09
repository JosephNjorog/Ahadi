/** Shared shapes for evidence collectors (SPEC §9). */

export interface ArtifactDraft {
  /** Stable local key; the pipeline maps it to the stored artifact id. */
  key: string;
  role: "evidence" | "deliverable";
  kind: "screenshot" | "log" | "file" | "report" | "dom" | "dataset" | "snapshot";
  mime: string;
  data: Buffer;
  label: string;
  meta?: Record<string, unknown>;
}

export interface ScanTarget {
  /** Raw HTML, Markdown, text or source file content scanned for injection. */
  content: string;
  location: string;
  format: "html" | "text" | "code";
}

export interface CollectorResult {
  /** Structured, compact summary for machine checks and the verifier agent. */
  summary: Record<string, unknown>;
  artifacts: ArtifactDraft[];
  /** Party-authored content shown to agents only inside nonce-tagged untrusted blocks. */
  untrustedBlocks: { id: string; source: string; text: string }[];
  scanTargets: ScanTarget[];
  /** Hidden-text findings extracted from a live rendering (computed styles), merged into the scan. */
  renderedHidden?: { text: string; location: string; reason: string }[];
  /** Keys of artifacts to send to the vision model. */
  imageKeys: string[];
  /** Collection problems worth showing (timeouts, blocked fetches). */
  warnings: string[];
}

export function emptyResult(): CollectorResult {
  return { summary: {}, artifacts: [], untrustedBlocks: [], scanTargets: [], imageKeys: [], warnings: [] };
}
