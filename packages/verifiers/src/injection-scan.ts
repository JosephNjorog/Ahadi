import { parse, type HTMLElement } from "node-html-parser";
import type { ScanTarget } from "./types";

/**
 * Deterministic injection scanner (SPEC §10.2 step 1). Extracts hidden DOM text, comments,
 * metadata, alt/title text, zero-width and bidi characters, and flags instruction-like patterns.
 * Output feeds the Injection Sentinel agent; a high-severity hit also blocks release on its own.
 */

export interface Finding {
  id: string;
  kind:
    | "hidden_text"
    | "comment"
    | "metadata"
    | "alt_text"
    | "attribute"
    | "invisible_chars"
    | "code_comment"
    | "instruction";
  location: string;
  text: string;
  hidden: boolean;
  patterns: string[];
  severity: "low" | "medium" | "high";
}

const PATTERNS: [string, RegExp][] = [
  [
    "addresses_ai",
    /\b(ai|a\.i\.|llm|gpt|claude|assistant|chatbot|language model|grader|verifier|reviewer|evaluator)\b/i,
  ],
  [
    "override",
    /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|earlier|instructions?|rules?|criteria)\b/i,
  ],
  [
    "approve",
    /\b(approve|approved|mark(ed)? as (passed|complete|met)|full payment|release (the )?(payment|funds)|100\s?%|all criteria (are )?(met|satisfied|pass))\b/i,
  ],
  [
    "fake_system",
    /(<\/?\s*(system|assistant|instructions?)\s*>|\[(system|inst)\]|###\s*system|system prompt|developer message)/i,
  ],
  [
    "already_verified",
    /\b(already (been )?(verified|approved|checked)|pre-?approved|verification (is )?complete)\b/i,
  ],
  ["score", /\b(score|grade|rating)\b.{0,20}\b(10\/10|100|perfect|maximum)\b/i],
];

const ZERO_WIDTH = /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/g;
const BIDI = /[‪-‮⁦-⁩]/g;
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;

export function matchPatterns(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Decodes Unicode "tag" characters (U+E0000 block), a known way to smuggle invisible ASCII. */
export function decodeTagChars(text: string): string {
  return [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0xe0020 && cp <= 0xe007e ? String.fromCodePoint(cp - 0xe0000) : "";
    })
    .join("");
}

function severity(hidden: boolean, patterns: string[]): Finding["severity"] {
  const strong = patterns.filter((p) => p !== "addresses_ai").length;
  if ((hidden && patterns.length > 0) || (patterns.includes("addresses_ai") && strong > 0)) return "high";
  if (patterns.length > 0 || hidden) return "medium";
  return "low";
}

const HIDDEN_STYLE = [
  [/display\s*:\s*none/i, "display:none"],
  [/visibility\s*:\s*hidden/i, "visibility:hidden"],
  [/font-size\s*:\s*0(px|em|rem|%)?\s*(;|$)/i, "font-size:0"],
  [/opacity\s*:\s*0(\.0+)?\s*(;|$)/i, "opacity:0"],
  [/(left|top|text-indent)\s*:\s*-\d{3,}px/i, "off-screen"],
  [
    /(width|height)\s*:\s*[01]px.*overflow\s*:\s*hidden|overflow\s*:\s*hidden.*(width|height)\s*:\s*[01]px/i,
    "clipped 1px",
  ],
  [/clip\s*:\s*rect\(\s*0/i, "clip:rect(0)"],
] as const;

function hiddenReason(el: HTMLElement): string | null {
  if (el.hasAttribute("hidden") || (el.getAttribute("aria-hidden") === "true" && !el.text.trim()))
    return "hidden attribute";
  const style = el.getAttribute("style") ?? "";
  for (const [re, label] of HIDDEN_STYLE) if (re.test(style)) return label;
  const color = /(^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[2]?.trim().toLowerCase();
  const bg = /background(-color)?\s*:\s*([^;]+)/i.exec(style)?.[2]?.trim().toLowerCase();
  if (color && bg && color === bg) return "same color as background";
  if (
    color &&
    ["white", "#fff", "#ffffff", "transparent", "rgba(0,0,0,0)"].includes(color.replace(/\s/g, ""))
  )
    return `text color ${color}`;
  return null;
}

/** CSS classes that hide content via a <style> block (e.g. `.x{display:none}`). */
function hiddenClasses(root: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const style of root.querySelectorAll("style")) {
    const css = style.text;
    for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      if (HIDDEN_STYLE.some(([re]) => re.test(m[2]!))) out.add(m[1]!);
    }
  }
  return out;
}

export function scanHtml(html: string, location: string, startIndex = 0): Finding[] {
  const findings: Finding[] = [];
  let n = startIndex;
  const push = (f: Omit<Finding, "id" | "severity" | "patterns"> & { patterns?: string[] }) => {
    const text = f.text.replace(/\s+/g, " ").trim();
    if (!text) return;
    const patterns = f.patterns ?? matchPatterns(text);
    findings.push({
      ...f,
      text: text.slice(0, 2000),
      patterns,
      id: `f${++n}`,
      severity: severity(f.hidden, patterns),
    });
  };

  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g))
    push({ kind: "comment", location: `${location} <!-- -->`, text: m[1]!, hidden: true });

  const root = parse(html, {
    comment: false,
    blockTextElements: { script: false, style: true, noscript: true },
  });
  const classes = hiddenClasses(root);

  const visit = (el: HTMLElement, path: string, ancestorHidden: string | null) => {
    const tag = el.rawTagName?.toLowerCase() ?? "";
    if (tag === "style") return;
    const cls = (el.getAttribute("class") ?? "").split(/\s+/).find((c) => classes.has(c));
    const reason = ancestorHidden ?? hiddenReason(el) ?? (cls ? `.${cls} hidden by CSS` : null);
    const here = tag ? `${path} > ${tag}${el.id ? `#${el.id}` : ""}` : path;
    if (reason && !ancestorHidden && el.text?.trim()) {
      push({ kind: "hidden_text", location: `${location} ${here} (${reason})`, text: el.text, hidden: true });
    }
    {
      for (const attr of ["alt", "title", "aria-label", "data-ai", "data-instructions", "placeholder"]) {
        const v = el.getAttribute(attr);
        if (v && matchPatterns(v).length)
          push({
            kind: attr === "alt" ? "alt_text" : "attribute",
            location: `${location} ${here}[${attr}]`,
            text: v,
            hidden: attr !== "placeholder",
          });
      }
      if (tag === "meta") {
        const content = el.getAttribute("content");
        if (content)
          push({
            kind: "metadata",
            location: `${location} meta[${el.getAttribute("name") ?? el.getAttribute("property") ?? "?"}]`,
            text: content,
            hidden: true,
          });
      }
      if (tag === "noscript" && el.text.trim())
        push({ kind: "hidden_text", location: `${location} ${here}`, text: el.text, hidden: true });
    }
    for (const child of el.childNodes)
      if ((child as HTMLElement).childNodes !== undefined && (child as HTMLElement).rawTagName)
        visit(child as HTMLElement, here, reason);
  };
  visit(root, "", null);

  // Visible text with instruction-like content (still worth classifying even if not hidden).
  const visible = root.querySelector("body")?.text ?? root.text;
  for (const sentence of visible.split(/(?<=[.!?])\s+|\n+/)) {
    const pats = matchPatterns(sentence);
    if (pats.includes("addresses_ai") && pats.length > 1)
      push({
        kind: "instruction",
        location: `${location} visible text`,
        text: sentence,
        hidden: false,
        patterns: pats,
      });
  }

  findings.push(...scanInvisibleChars(html, location, n + findings.length));
  return dedupe(findings);
}

export function scanInvisibleChars(text: string, location: string, startIndex = 0): Finding[] {
  const out: Finding[] = [];
  const zw = text.match(ZERO_WIDTH)?.length ?? 0;
  const bidi = text.match(BIDI)?.length ?? 0;
  const tags = text.match(TAG_CHARS) ?? [];
  if (tags.length) {
    const decoded = decodeTagChars(tags.join(""));
    const patterns = matchPatterns(decoded);
    out.push({
      id: `f${startIndex + out.length + 1}`,
      kind: "invisible_chars",
      location: `${location} (Unicode tag characters)`,
      text: decoded.slice(0, 2000),
      hidden: true,
      patterns,
      severity: severity(true, patterns),
    });
  }
  if (zw >= 8 || bidi > 0) {
    // Zero-width sequences can encode bits; show the context around the densest run.
    const idx = text.search(
      ZERO_WIDTH.source ? new RegExp(`[\\u200B-\\u200F\\u2060-\\u2064\\uFEFF]{4,}`) : /$^/,
    );
    const context =
      idx >= 0
        ? text
            .slice(Math.max(0, idx - 120), idx + 200)
            .replace(ZERO_WIDTH, "⟨ZW⟩")
            .replace(BIDI, "⟨BIDI⟩")
        : "";
    out.push({
      id: `f${startIndex + out.length + 1}`,
      kind: "invisible_chars",
      location: `${location} (${zw} zero-width, ${bidi} bidi characters)`,
      text: context || `${zw} zero-width and ${bidi} bidi-control characters`,
      hidden: true,
      patterns: matchPatterns(context),
      severity: zw >= 32 || bidi > 0 ? "medium" : "low",
    });
  }
  return out;
}

/** Plain text / Markdown: HTML comments, invisible characters and instruction-like sentences. */
export function scanText(text: string, location: string, startIndex = 0): Finding[] {
  const findings: Finding[] = [];
  let n = startIndex;
  for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
    const patterns = matchPatterns(m[1]!);
    findings.push({
      id: `f${++n}`,
      kind: "comment",
      location: `${location} <!-- -->`,
      text: m[1]!.trim().slice(0, 2000),
      hidden: true,
      patterns,
      severity: severity(true, patterns),
    });
  }
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const patterns = matchPatterns(sentence);
    if (patterns.includes("addresses_ai") && patterns.length > 1)
      findings.push({
        id: `f${++n}`,
        kind: "instruction",
        location: `${location} text`,
        text: sentence.trim().slice(0, 2000),
        hidden: false,
        patterns,
        severity: severity(false, patterns),
      });
  }
  findings.push(...scanInvisibleChars(text, location, n));
  return dedupe(findings);
}

/** Source code: comments and string literals that address an AI. */
export function scanCode(source: string, location: string, startIndex = 0): Finding[] {
  const findings: Finding[] = [];
  let n = startIndex;
  const comments = [...source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"""[\s\S]*?"""/g)].map(
    (m) => m[0],
  );
  for (const c of comments) {
    const patterns = matchPatterns(c);
    if (patterns.includes("addresses_ai") && patterns.length > 1)
      findings.push({
        id: `f${++n}`,
        kind: "code_comment",
        location,
        text: c.slice(0, 2000),
        hidden: false,
        patterns,
        severity: severity(false, patterns),
      });
  }
  findings.push(...scanInvisibleChars(source, location, n));
  return findings;
}

export function scanTargets(
  targets: ScanTarget[],
  rendered: { text: string; location: string; reason: string }[] = [],
): Finding[] {
  const out: Finding[] = [];
  for (const t of targets) {
    const f =
      t.format === "html"
        ? scanHtml(t.content, t.location, out.length)
        : t.format === "code"
          ? scanCode(t.content, t.location, out.length)
          : scanText(t.content, t.location, out.length);
    out.push(...f);
  }
  for (const r of rendered) {
    const patterns = matchPatterns(r.text);
    out.push({
      id: `f${out.length + 1}`,
      kind: "hidden_text",
      location: `${r.location} (${r.reason}, rendered)`,
      text: r.text.slice(0, 2000),
      hidden: true,
      patterns,
      severity: severity(true, patterns),
    });
  }
  return dedupe(out).map((f, i) => ({ ...f, id: `f${i + 1}` }));
}

/** Strip-and-compare (SPEC §10.2 step 5): remove flagged passages before verification. */
export function stripFindings(content: string, findings: Finding[]): string {
  let out = content.replace(TAG_CHARS, "").replace(ZERO_WIDTH, "").replace(BIDI, "");
  // Highest severity, then longest, first, so an overlapping finding can't break a longer match.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const ordered = [...findings].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.text.length - a.text.length,
  );
  for (const f of ordered) {
    if (f.severity === "low") continue;
    // Findings are whitespace-normalised; match the original with any whitespace between words.
    const words = f.text
      .replace(TAG_CHARS, "")
      .replace(ZERO_WIDTH, "")
      .replace(BIDI, "")
      .slice(0, 300)
      .split(/\s+/)
      .filter(Boolean);
    if (words.join(" ").length < 12) continue;
    const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
    out = out.replace(pattern, "[removed by Ahadi: suspected instruction to the verifier]");
  }
  return out;
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.kind}|${f.text.slice(0, 120)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function highestSeverity(fs: Finding[]): Finding["severity"] | null {
  if (fs.some((f) => f.severity === "high")) return "high";
  if (fs.some((f) => f.severity === "medium")) return "medium";
  return fs.length ? "low" : null;
}
