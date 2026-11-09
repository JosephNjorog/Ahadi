import { parse } from "node-html-parser";
import { mapLimit, safeFetch } from "./fetch";
import { emptyResult, type CollectorResult } from "./types";

/** SPEC §9.4 writing & research collector. */

export interface Citation {
  index: number | null;
  url: string;
  label: string;
  status: number | string | null;
  resolves: boolean;
  snapshotKey?: string;
}

export interface WritingSummary {
  source: "text" | "url";
  wordCount: number;
  headings: { level: number; text: string }[];
  readingLevel: { fleschReadingEase: number; gradeLevel: number };
  citations: Citation[];
  resolvingCitations: number;
  sampledClaims: {
    claim: string;
    citationIndex: number;
    sourceUrl: string | null;
    snapshotKey: string | null;
  }[];
}

export function htmlToText(html: string): string {
  const root = parse(html);
  root.querySelectorAll("script,style,noscript,nav,footer").forEach((n) => n.remove());
  return (
    root.querySelector("main") ??
    root.querySelector("article") ??
    root.querySelector("body") ??
    root
  ).structuredText
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wordCount(text: string): number {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`|[\]()-]/g, " ");
  return stripped.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function headingsOf(markdown: string): { level: number; text: string }[] {
  return [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({
    level: m[1]!.length,
    text: m[2]!.trim(),
  }));
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function readingLevel(text: string) {
  const sentences = Math.max(1, text.split(/[.!?]+\s/).filter((s) => s.trim().length > 3).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const wc = Math.max(1, words.length);
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const ease = 206.835 - 1.015 * (wc / sentences) - 84.6 * (syl / wc);
  const grade = 0.39 * (wc / sentences) + 11.8 * (syl / wc) - 15.59;
  return { fleschReadingEase: Math.round(ease * 10) / 10, gradeLevel: Math.round(grade * 10) / 10 };
}

/** Numbered "Sources" entries ("1. Name — https://…") plus any other URLs in the text. */
export function extractCitations(markdown: string): { index: number | null; url: string; label: string }[] {
  const out: { index: number | null; url: string; label: string }[] = [];
  const seen = new Set<string>();
  const sourcesIdx = markdown.search(/^#{1,6}\s*(sources|references|bibliography|works cited)\b/im);
  const sources = sourcesIdx >= 0 ? markdown.slice(sourcesIdx) : "";
  for (const m of sources.matchAll(/^\s*(?:\[(\d+)\]|(\d+)[.)])\s*(.*?)(https?:\/\/[^\s)>\]]+)/gm)) {
    const url = m[4]!.replace(/[.,;]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ index: Number(m[1] ?? m[2]), url, label: m[3]!.replace(/[—–-]\s*$/, "").trim() });
  }
  for (const m of markdown.matchAll(/https?:\/\/[^\s)>\]"']+/g)) {
    const url = m[0].replace(/[.,;]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ index: null, url, label: "" });
  }
  return out;
}

/** Sentences carrying a [n] citation — up to `max`, spread across the document. */
export function sampleClaims(markdown: string, max = 5): { claim: string; citationIndex: number }[] {
  const body = markdown.split(/^#{1,6}\s*(sources|references)\b/im)[0]!;
  const claims = body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => ({ s: s.trim(), m: /\[(\d+)\]/.exec(s) }))
    .filter((x) => x.m && x.s.length > 30)
    .map((x) => ({ claim: x.s.replace(/^[-*]\s*/, "").slice(0, 400), citationIndex: Number(x.m![1]) }));
  if (claims.length <= max) return claims;
  const step = claims.length / max;
  return Array.from({ length: max }, (_, i) => claims[Math.floor(i * step)]!);
}

export async function collectWriting(input: {
  text?: string | null;
  url?: string | null;
}): Promise<CollectorResult> {
  const result = emptyResult();
  let text = input.text ?? "";
  if (!text && input.url) {
    try {
      const r = await safeFetch(input.url, { maxBytes: 3 * 1024 * 1024 });
      const body = r.body.toString("utf8");
      text = /html/i.test(r.contentType) ? htmlToText(body) : body;
      result.scanTargets.push({
        content: body,
        location: input.url,
        format: /html/i.test(r.contentType) ? "html" : "text",
      });
    } catch (e) {
      result.warnings.push(`Could not fetch ${input.url}: ${(e as Error).message}`);
    }
  } else {
    result.scanTargets.push({ content: text, location: "submitted text", format: "text" });
  }

  const cites = extractCitations(text);
  const citations: Citation[] = await mapLimit(cites, 4, async (c) => {
    try {
      const r = await safeFetch(c.url, { timeoutMs: 12_000, maxBytes: 1.5 * 1024 * 1024 });
      const ok = r.status >= 200 && r.status < 400;
      let snapshotKey: string | undefined;
      if (ok) {
        snapshotKey = `source_${c.index ?? cites.indexOf(c) + 100}`;
        const snap = /html/i.test(r.contentType)
          ? htmlToText(r.body.toString("utf8"))
          : r.body.toString("utf8");
        result.artifacts.push({
          key: snapshotKey,
          role: "evidence",
          kind: "snapshot",
          mime: "text/plain",
          data: Buffer.from(snap.slice(0, 60_000)),
          label: `Text snapshot of ${c.url}`,
          meta: { url: c.url, status: r.status },
        });
      }
      return { ...c, status: r.status, resolves: ok, snapshotKey };
    } catch (e) {
      return { ...c, status: (e as Error).message.slice(0, 80), resolves: false };
    }
  });

  const claims = sampleClaims(text).map((cl) => {
    const c = citations.find((x) => x.index === cl.citationIndex);
    return { ...cl, sourceUrl: c?.url ?? null, snapshotKey: c?.snapshotKey ?? null };
  });
  // Give the verifier the relevant part of each sampled source (keyword window), as untrusted content.
  for (const cl of claims) {
    if (!cl.snapshotKey) continue;
    const snap = result.artifacts.find((a) => a.key === cl.snapshotKey)!.data.toString("utf8");
    result.untrustedBlocks.push({
      id: `${cl.snapshotKey}-excerpt`,
      source: `cited source ${cl.sourceUrl}`,
      text: relevantWindow(snap, cl.claim),
    });
  }

  const summary: WritingSummary = {
    source: input.text ? "text" : "url",
    wordCount: wordCount(text),
    headings: headingsOf(text),
    readingLevel: readingLevel(text),
    citations,
    resolvingCitations: citations.filter((c) => c.resolves).length,
    sampledClaims: claims,
  };
  result.untrustedBlocks.unshift({ id: "document", source: "deliverable", text: text.slice(0, 60_000) });
  result.artifacts.push({
    key: "text_content",
    role: "evidence",
    kind: "file",
    mime: "text/markdown",
    data: Buffer.from(text),
    label: "Submitted text",
  });
  result.artifacts.push({
    key: "citations",
    role: "evidence",
    kind: "report",
    mime: "application/json",
    data: Buffer.from(JSON.stringify(summary)),
    label: "Citation and structure report",
  });
  result.summary = summary as unknown as Record<string, unknown>;
  return result;
}

function relevantWindow(source: string, claim: string, size = 2500): string {
  const words = [...new Set(claim.toLowerCase().match(/[a-z]{5,}/g) ?? [])];
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < source.length; i += 500) {
    const chunk = source.slice(i, i + size).toLowerCase();
    const score = words.reduce((s, w) => s + (chunk.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return source.slice(best, best + size);
}
