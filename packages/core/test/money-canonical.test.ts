import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyBps, dollarsToMinor, formatMoney, fromPayPalValue, toPayPalValue } from "../src/money";
import { canonicalJson, hashTerms } from "../src/canonical";
import { idempotencyKeys } from "../src/idempotency";
import { validateTerms, type TermsBody } from "../src/criteria";

describe("money", () => {
  it("converts to and from PayPal values", () => {
    expect(toPayPalValue(40_000)).toBe("400.00");
    expect(toPayPalValue(5)).toBe("0.05");
    expect(fromPayPalValue("286.53")).toBe(28_653);
    expect(fromPayPalValue("10.5")).toBe(1050);
    expect(fromPayPalValue("7")).toBe(700);
    expect(() => fromPayPalValue("1.234")).toThrow();
    expect(() => fromPayPalValue("-1.00")).toThrow();
    expect(() => toPayPalValue(1.5)).toThrow();
  });

  it("round-trips any amount", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e12 }), (m) => fromPayPalValue(toPayPalValue(m)) === m));
  });

  it("applies bps with floor, including beyond safe-integer products", () => {
    expect(applyBps(30_000, 150)).toBe(450);
    expect(applyBps(333, 7500)).toBe(249);
    expect(applyBps(2 ** 50, 9999)).toBe(Number((BigInt(2 ** 50) * 9999n) / 10000n));
  });

  it("formats and parses dollars", () => {
    expect(formatMoney(30_000)).toBe("$300.00");
    expect(dollarsToMinor(25)).toBe(2500);
    expect(dollarsToMinor(0.1 + 0.2)).toBe(30);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });
  it("hashes equal objects equally regardless of key order", () => {
    expect(hashTerms({ a: 1, b: 2 })).toBe(hashTerms({ b: 2, a: 1 }));
    expect(hashTerms({ a: 1 })).not.toBe(hashTerms({ a: 2 }));
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe("idempotency keys", () => {
  it("are deterministic and within PayPal limits", () => {
    const id = "9f1c2a4b-1111-2222-3333-444455556666";
    expect(idempotencyKeys.capture(id)).toBe(`ahadi:capture:${id}`);
    expect(idempotencyKeys.createOrder(id, 2).length).toBeLessThanOrEqual(108);
    expect(idempotencyKeys.payoutBatch(id)).toBe("ahadi_po_9f1c2a4b111122223333444455556666");
  });
});

describe("validateTerms", () => {
  const body: TermsBody = {
    title: "Bakery",
    category: "web",
    currency: "USD",
    scopeSummary: "",
    outOfScope: [],
    assumptions: [],
    milestones: [
      {
        position: 1,
        title: "Landing page",
        summary: "",
        amountMinor: 40_000,
        deliverables: ["site"],
        criteria: [
          { id: "c1", title: "Up", description: "200", weight: 50, required: true, method: "automated", check: { kind: "http_ok" }, evidence: ["dom_snapshot"], partialCredit: false },
          { id: "c2", title: "Hero", description: "x", weight: 50, required: false, method: "ai_judgment", evidence: ["screenshot_desktop"], partialCredit: false },
        ],
      },
    ],
  };
  it("accepts valid terms", () => expect(validateTerms(body, 40_000)).toEqual([]));
  it("catches budget, weight and method errors", () => {
    const bad = structuredClone(body);
    bad.milestones[0]!.criteria[1]!.weight = 40;
    bad.milestones[0]!.criteria[0]!.check = undefined;
    const msgs = validateTerms(bad, 50_000).map((i) => i.message).join("|");
    expect(msgs).toMatch(/budget/);
    expect(msgs).toMatch(/sum to 90/);
    expect(msgs).toMatch(/needs a machine check/);
  });
});
