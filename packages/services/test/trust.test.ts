import { describe, expect, it } from "vitest";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.DATABASE_URL ??= "postgres://unused";

const { signDocument, verifyDocument, signingPublicKey } = await import("../src/signing");
const { bucket, providerScore } = await import("../src/passport");

describe("statement signing", () => {
  it("signs canonical JSON with a stable Ed25519 key and detects tampering", () => {
    const doc = { b: 2, a: [1, 2], total: 28470 };
    const { signature, kid } = signDocument(doc);
    expect(kid).toBe(signingPublicKey().kid);
    expect(verifyDocument({ a: [1, 2], total: 28470, b: 2 }, signature)).toBe(true);
    expect(verifyDocument({ ...doc, total: 28471 }, signature)).toBe(false);
    expect(signingPublicKey().jwk).toMatchObject({ kty: "OKP", crv: "Ed25519" });
  });
});

describe("passport", () => {
  it("buckets earnings", () => {
    expect(bucket(0)).toBe("$0–100");
    expect(bucket(30_000)).toBe("$100–500");
    expect(bucket(250_000)).toBe("$1k–5k");
    expect(bucket(9_000_000)).toBe("$50k+");
  });
  it("computes the provider score per SPEC §15", () => {
    expect(providerScore({ firstPassRate: 1, avgReleaseRate: 1, settledCount: 20 }, 0)).toBe(1);
    expect(providerScore({ firstPassRate: 0.5, avgReleaseRate: 0.8, settledCount: 10 }, 0)).toBe(0.59);
    expect(providerScore({ firstPassRate: 0.5, avgReleaseRate: 0.8, settledCount: 10 }, 3)).toBe(0);
  });
});
