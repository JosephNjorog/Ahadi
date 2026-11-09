import { createHash } from "node:crypto";

/**
 * Canonical JSON (SPEC §11.2): object keys sorted, no whitespace, UTF-8.
 * `undefined` object members are dropped (as JSON.stringify does); non-finite numbers are rejected
 * so two parties can never hash "the same" terms to different values.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(v);
    case "bigint":
      return JSON.stringify(v.toString());
    case "object": {
      if (v instanceof Date) return JSON.stringify(v.toISOString());
      if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : serialize(x))).join(",")}]`;
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`);
  }
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** body_hash for terms_versions / signatures. */
export function hashTerms(body: unknown): string {
  return sha256Hex(canonicalJson(body));
}
