import Ajv from "ajv";
import Papa from "papaparse";
import { emptyResult, type CollectorResult } from "./types";

/** SPEC §9.5 data collector: profile a CSV/JSON dataset, optional JSON-Schema validation. */

export interface ColumnProfile {
  name: string;
  type: "number" | "boolean" | "date" | "string" | "mixed" | "empty";
  nullRate: number;
  distinct: number;
  topValues: { value: string; count: number }[];
  min?: number;
  max?: number;
}

export interface DatasetProfile {
  format: "csv" | "json";
  rowCount: number;
  columns: ColumnProfile[];
  duplicateRows: number;
  sample: Record<string, unknown>[];
  schemaValidation?: { valid: boolean; errors: string[] };
}

export function parseDataset(
  raw: string,
  hint?: string,
): { format: "csv" | "json"; rows: Record<string, unknown>[] } {
  const trimmed = raw.trim();
  if (hint === "json" || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(j)
      ? j
      : Array.isArray((j as { data?: unknown }).data)
        ? (j as { data: unknown[] }).data
        : [j];
    return { format: "json", rows: rows as Record<string, unknown>[] };
  }
  const p = Papa.parse<Record<string, unknown>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return { format: "csv", rows: p.data };
}

export function profileRows(rows: Record<string, unknown>[], format: "csv" | "json"): DatasetProfile {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
  const columns: ColumnProfile[] = cols.map((name) => {
    const values = rows.map((r) => r?.[name]);
    const present = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const strs = present.map((v) => String(v));
    const nums = strs.map((s) => Number(s.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
    const isNum = present.length > 0 && nums.length === present.length;
    const isBool = present.length > 0 && strs.every((s) => /^(true|false|yes|no|0|1)$/i.test(s));
    const isDate = present.length > 0 && !isNum && strs.every((s) => !Number.isNaN(Date.parse(s)));
    const counts = new Map<string, number>();
    for (const s of strs) counts.set(s, (counts.get(s) ?? 0) + 1);
    return {
      name,
      type:
        present.length === 0
          ? "empty"
          : isBool
            ? "boolean"
            : isNum
              ? "number"
              : isDate
                ? "date"
                : strs.every((s) => Number.isNaN(Number(s)))
                  ? "string"
                  : "mixed",
      nullRate: rows.length ? Math.round(((rows.length - present.length) / rows.length) * 1000) / 1000 : 0,
      distinct: counts.size,
      topValues: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value: value.slice(0, 80), count })),
      ...(isNum ? { min: Math.min(...nums), max: Math.max(...nums) } : {}),
    };
  });
  const keys = rows.map((r) => JSON.stringify(r));
  const duplicateRows = keys.length - new Set(keys).size;
  const step = Math.max(1, Math.floor(rows.length / 20));
  const sample = rows.filter((_, i) => i % step === 0).slice(0, 20);
  return { format, rowCount: rows.length, columns, duplicateRows, sample };
}

export function validateAgainstSchema(rows: unknown, schema: unknown): { valid: boolean; errors: string[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema as object);
  const ok = validate(rows);
  return {
    valid: Boolean(ok),
    errors: (validate.errors ?? []).slice(0, 20).map((e) => `${e.instancePath || "/"} ${e.message}`),
  };
}

export async function collectData(input: {
  raw: string;
  fileName: string;
  schema?: unknown;
}): Promise<CollectorResult> {
  const result = emptyResult();
  try {
    const { format, rows } = parseDataset(input.raw, input.fileName.endsWith(".json") ? "json" : undefined);
    const profile = profileRows(rows, format);
    if (input.schema) profile.schemaValidation = validateAgainstSchema(rows, input.schema);
    result.summary = profile as unknown as Record<string, unknown>;
    result.artifacts.push({
      key: "dataset_profile",
      role: "evidence",
      kind: "report",
      mime: "application/json",
      data: Buffer.from(JSON.stringify(profile)),
      label: "Dataset profile",
    });
    result.untrustedBlocks.push({
      id: "sample-rows",
      source: "deliverable",
      text: JSON.stringify(profile.sample, null, 1).slice(0, 20000),
    });
    result.scanTargets.push({
      content: input.raw.slice(0, 500_000),
      location: input.fileName,
      format: "text",
    });
  } catch (e) {
    result.warnings.push(`Could not parse ${input.fileName}: ${(e as Error).message}`);
    result.summary = { error: (e as Error).message };
  }
  return result;
}
