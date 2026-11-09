import type { MachineCheck } from "@ahadi/core";
import type { CodeSummary } from "./code";
import type { DatasetProfile } from "./data";
import type { DesignSummary } from "./design";
import type { WebSummary } from "./web";
import type { WritingSummary } from "./writing";

/** Machine checks decide "automated" criteria in code (SPEC §4.4, §9). Confidence is 1 when decided. */

export interface MachineResult {
  outcome: "pass" | "fail" | "undetermined";
  credit: number;
  confidence: number;
  reasoning: string;
  evidenceKeys: string[];
}

export interface CheckContext {
  web?: WebSummary;
  writing?: WritingSummary;
  code?: CodeSummary;
  design?: DesignSummary;
  data?: DatasetProfile;
  files?: { fileName: string }[];
  schemas?: Record<string, unknown>;
  dataValidate?: (schema: unknown) => { valid: boolean; errors: string[] };
}

const pass = (reasoning: string, evidenceKeys: string[]): MachineResult => ({
  outcome: "pass",
  credit: 1,
  confidence: 1,
  reasoning,
  evidenceKeys,
});
const fail = (reasoning: string, evidenceKeys: string[]): MachineResult => ({
  outcome: "fail",
  credit: 0,
  confidence: 1,
  reasoning,
  evidenceKeys,
});
const undetermined = (reasoning: string, evidenceKeys: string[] = []): MachineResult => ({
  outcome: "undetermined",
  credit: 0,
  confidence: 0,
  reasoning,
  evidenceKeys,
});

function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/§§/g, "(.*/)?");
  return new RegExp(`^${re}$`, "i");
}

export function evaluateCheck(check: MachineCheck, ctx: CheckContext): MachineResult {
  const w = ctx.web;
  switch (check.kind) {
    case "http_ok": {
      if (!w) return undetermined("No web evidence was collected");
      if (w.status == null) return fail(`The URL did not respond (${w.url})`, ["web_report"]);
      return w.status >= 200 && w.status < 300
        ? pass(`${w.finalUrl ?? w.url} returned HTTP ${w.status}`, ["web_report"])
        : fail(`The URL returned HTTP ${w.status}`, ["web_report"]);
    }
    case "no_horizontal_scroll": {
      const s = w?.scrollChecks[String(check.viewportWidth)];
      if (!s)
        return undetermined(
          w?.rendered === false || !w
            ? "The page could not be rendered in a browser"
            : `No measurement at ${check.viewportWidth}px`,
        );
      return s.horizontalScroll
        ? fail(
            `At ${check.viewportWidth}px the page is ${s.scrollWidth}px wide, so it scrolls sideways. Something on the page is wider than the screen.`,
            ["screenshot_mobile", "web_report"],
          )
        : pass(
            `At ${check.viewportWidth}px the page fits the screen (${s.scrollWidth}px wide, no horizontal scroll).`,
            ["screenshot_mobile", "web_report"],
          );
    }
    case "dom_contains": {
      const dom = check.viewport === "mobile" ? w?.mobile?.dom : w?.desktop?.dom;
      const text = dom?.visibleText ?? w?.fetchOnly?.text;
      if (!text) return undetermined("No page text was collected");
      const needle = check.text?.toLowerCase();
      if (needle && !text.toLowerCase().includes(needle))
        return fail(`The page text does not contain "${check.text}"`, ["dom_snapshot"]);
      if (check.selector) {
        const sel = check.selector.toLowerCase();
        const present = sel.startsWith("form")
          ? (dom?.forms.length ?? 0) > 0
          : sel.startsWith("img")
            ? (dom?.images.length ?? 0) > 0
            : /^h[1-6]/.test(sel)
              ? (dom?.headings.some((h) => `h${h.level}` === sel.slice(0, 2)) ?? false)
              : null;
        if (present === false) return fail(`No element matches ${check.selector}`, ["dom_snapshot"]);
        if (present === null && !needle)
          return undetermined(`Selector ${check.selector} needs a reviewer`, ["dom_snapshot"]);
      }
      return pass(
        `Found${check.text ? ` "${check.text}"` : ""}${check.selector ? ` ${check.selector}` : ""} on the ${check.viewport ?? "desktop"} page`,
        ["dom_snapshot"],
      );
    }
    case "form_submits": {
      const t = w?.formTests[check.selector];
      if (!t) return undetermined(`The form ${check.selector} was not tested`);
      if (t.status == null)
        return fail(`Submitting ${check.selector} failed: ${t.error ?? "no response"}`, ["web_report"]);
      return t.status === check.expectStatus
        ? pass(`Submitting the form returned HTTP ${t.status} as required`, ["web_report"])
        : fail(`Submitting the form returned HTTP ${t.status}; ${check.expectStatus} was required`, [
            "web_report",
          ]);
    }
    case "lcp_ms": {
      const lcp = w?.mobile?.lcpMs ?? w?.desktop?.lcpMs;
      if (lcp == null) return undetermined("Largest Contentful Paint could not be measured");
      return lcp <= check.max
        ? pass(`LCP ${lcp} ms ≤ ${check.max} ms`, ["web_report"])
        : fail(`LCP ${lcp} ms is above the ${check.max} ms limit`, ["web_report"]);
    }
    case "lighthouse":
      return undetermined(
        `Lighthouse (${check.metric} ≥ ${check.min}) is not run in this deployment; a reviewer decides`,
        ["web_report"],
      );
    case "word_count": {
      const n = ctx.writing?.wordCount;
      if (n == null) return undetermined("No text was collected");
      if (check.min != null && n < check.min)
        return fail(`${n} words; at least ${check.min} required`, ["text_content"]);
      if (check.max != null && n > check.max)
        return fail(`${n} words; at most ${check.max} allowed`, ["text_content"]);
      return pass(
        `${n} words${check.min != null ? ` (min ${check.min})` : ""}${check.max != null ? ` (max ${check.max})` : ""}`,
        ["text_content"],
      );
    }
    case "min_citations": {
      const cites = ctx.writing?.citations;
      if (!cites) return undetermined("No citations were extracted");
      const counted = check.mustResolve ? cites.filter((c) => c.resolves) : cites;
      const dead = cites.filter((c) => !c.resolves);
      const deadNote = dead.length
        ? ` Not reachable: ${dead.map((d) => `${d.url} (${d.status})`).join(", ")}.`
        : "";
      return counted.length >= check.count
        ? pass(
            `${counted.length} ${check.mustResolve ? "reachable " : ""}citations (need ${check.count}).${deadNote}`,
            ["citations"],
          )
        : fail(
            `${counted.length} ${check.mustResolve ? "reachable " : ""}citations; ${check.count} required.${deadNote}`,
            ["citations"],
          );
    }
    case "build_succeeds": {
      const b = ctx.code?.builds.find((x) => x.command === check.command);
      if (!b) return undetermined(ctx.code?.sandbox.note ?? `"${check.command}" was not run`);
      return b.exitCode === 0
        ? pass(`\`${check.command}\` succeeded in ${Math.round(b.durationMs / 1000)}s`, [b.logKey])
        : fail(`\`${check.command}\` exited with code ${b.exitCode}`, [b.logKey]);
    }
    case "test_suite": {
      const t = ctx.code?.testRuns.find((x) => x.command === check.command);
      if (!t) return undetermined(ctx.code?.sandbox.note ?? `"${check.command}" was not run`);
      if (!t.tests || t.tests.passRate == null)
        return t.exitCode === 0
          ? pass(`\`${check.command}\` passed (exit 0; per-test counts not reported)`, [t.logKey])
          : fail(`\`${check.command}\` exited with code ${t.exitCode} and no parsable test results`, [
              t.logKey,
            ]);
      const pct = Math.round(t.tests.passRate * 1000) / 10;
      return t.tests.passRate >= check.minPassRate
        ? pass(
            `${t.tests.passed}/${t.tests.total} tests passed (${pct}%; need ${check.minPassRate * 100}%)`,
            [t.logKey],
          )
        : fail(
            `${t.tests.passed}/${t.tests.total} tests passed (${pct}%); ${check.minPassRate * 100}% required`,
            [t.logKey],
          );
    }
    case "file_set": {
      const paths = ctx.code?.fileTree ?? ctx.files?.map((f) => f.fileName) ?? [];
      if (!paths.length) return undetermined("No files were listed");
      const missing = check.patterns.filter((p) => !paths.some((x) => globToRegExp(p).test(x)));
      const matching = paths.filter((x) => check.patterns.some((p) => globToRegExp(p).test(x)));
      if (missing.length)
        return fail(`No files match ${missing.join(", ")}`, [ctx.code ? "code_report" : "design_report"]);
      if (check.minCount != null && matching.length < check.minCount)
        return fail(`${matching.length} matching files; ${check.minCount} required`, [
          ctx.code ? "code_report" : "design_report",
        ]);
      return pass(`${matching.length} files match ${check.patterns.join(", ")}`, [
        ctx.code ? "code_report" : "design_report",
      ]);
    }
    case "image_dimensions": {
      const imgs = ctx.design?.images ?? [];
      if (!imgs.length) return undetermined("No images were delivered");
      const tol = check.tolerancePx ?? 0;
      const ok = imgs.filter(
        (i) => Math.abs(i.width - check.width) <= tol && Math.abs(i.height - check.height) <= tol,
      );
      return ok.length
        ? pass(
            `${ok.map((i) => `${i.fileName} is ${i.width}×${i.height}`).join("; ")} (need ${check.width}×${check.height}${tol ? ` ±${tol}px` : ""})`,
            ok.map((i) => `preview_${i.key}`),
          )
        : fail(
            `No image is ${check.width}×${check.height}${tol ? ` ±${tol}px` : ""}: ${imgs.map((i) => `${i.fileName} ${i.width}×${i.height}`).join(", ")}`,
            imgs.map((i) => `preview_${i.key}`),
          );
    }
    case "json_schema": {
      const schema = ctx.schemas?.[check.schemaArtifactId];
      if (!schema || !ctx.dataValidate) return undetermined("The client's JSON Schema was not found");
      const r = ctx.dataValidate(schema);
      return r.valid
        ? pass("The dataset validates against the client's JSON Schema", ["dataset_profile"])
        : fail(`Schema errors: ${r.errors.slice(0, 5).join("; ")}`, ["dataset_profile"]);
    }
    case "csv_columns": {
      const d = ctx.data;
      if (!d) return undetermined("No dataset was profiled");
      const cols = new Set(d.columns.map((c) => c.name.trim().toLowerCase()));
      const missing = check.columns.filter((c) => !cols.has(c.trim().toLowerCase()));
      if (missing.length) return fail(`Missing columns: ${missing.join(", ")}`, ["dataset_profile"]);
      if (check.minRows != null && d.rowCount < check.minRows)
        return fail(`${d.rowCount} rows; ${check.minRows} required`, ["dataset_profile"]);
      return pass(`All ${check.columns.length} columns present, ${d.rowCount} rows`, ["dataset_profile"]);
    }
  }
}
