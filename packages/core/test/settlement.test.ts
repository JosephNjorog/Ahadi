import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computePayoutPlan,
  computeProposal,
  estimateMpesaKes,
  normaliseCreditPct,
  type SettlementInput,
} from "../src/settlement";

const policy = { minAutoConfidence: 0.8, platformFeeBps: 150, humanConfirmAboveMinor: 100_000 };

/** The bakery demo: $400, four criteria at 25 each, mobile layout fails. */
const bakery = (overrides: Partial<SettlementInput> = {}): SettlementInput => ({
  milestoneAmountMinor: 40_000,
  criteria: [
    { id: "c1", weight: 25, required: true, partialCredit: false },
    { id: "c2", weight: 25, required: false, partialCredit: false },
    { id: "c3", weight: 25, required: false, partialCredit: true },
    { id: "c4", weight: 25, required: false, partialCredit: false },
  ],
  results: [
    { criterionId: "c1", outcome: "pass", credit: 1, confidence: 0.99 },
    { criterionId: "c2", outcome: "pass", credit: 1, confidence: 0.92 },
    { criterionId: "c3", outcome: "pass", credit: 1, confidence: 0.9 },
    { criterionId: "c4", outcome: "fail", credit: 0, confidence: 0.97 },
  ],
  injectionFlagged: false,
  policy,
  ...overrides,
});

describe("computeProposal", () => {
  it("releases 75% ($300) when 3 of 4 equal-weight criteria pass", () => {
    const p = computeProposal(bakery());
    expect(p.kind).toBe("release");
    expect(p.releaseBps).toBe(7500);
    expect(p.captureMinor).toBe(30_000);
    expect(p.platformFeeMinor).toBe(450);
    expect(p.workerEstimateMinor).toBe(29_550);
    expect(p.requiresHumanConfirm).toBe(false);
  });

  it("releases 100% when everything passes", () => {
    const input = bakery();
    input.results[3] = { criterionId: "c4", outcome: "pass", credit: 1, confidence: 0.95 };
    const p = computeProposal(input);
    expect(p.releaseBps).toBe(10000);
    expect(p.captureMinor).toBe(40_000);
  });

  it("gives partial credit only where allowed, rounded to 0.05", () => {
    const input = bakery();
    input.results[2] = { criterionId: "c3", outcome: "partial", credit: 0.62, confidence: 0.9 };
    const p = computeProposal(input);
    // c1 25 + c2 25 + c3 25×0.60 = 65%
    expect(p.releaseBps).toBe(6500);
    expect(p.breakdown.find((c) => c.id === "c3")!.creditPct).toBe(60);
  });

  it("treats partial on a binary criterion as zero credit", () => {
    const input = bakery();
    input.results[1] = { criterionId: "c2", outcome: "partial", credit: 0.9, confidence: 0.9 };
    expect(computeProposal(input).releaseBps).toBe(5000);
  });

  it("returns zero when a required criterion fails", () => {
    const input = bakery();
    input.results[0] = { criterionId: "c1", outcome: "fail", credit: 0, confidence: 0.99 };
    const p = computeProposal(input);
    expect(p.kind).toBe("zero");
    expect(p.blockedReason).toBe("required_failed");
    expect(p.captureMinor).toBe(0);
  });

  it("blocks on injection before anything else", () => {
    const input = bakery({ injectionFlagged: true });
    input.results[0] = { criterionId: "c1", outcome: "undetermined", credit: 0, confidence: 0.1 };
    const p = computeProposal(input);
    expect(p.kind).toBe("blocked");
    expect(p.blockedReason).toBe("injection");
  });

  it("blocks on undetermined before low confidence", () => {
    const input = bakery();
    input.results[1] = { criterionId: "c2", outcome: "undetermined", credit: 0, confidence: 0.2 };
    expect(computeProposal(input).blockedReason).toBe("undetermined");
  });

  it("blocks on low confidence and names the criteria", () => {
    const input = bakery();
    input.results[2] = { criterionId: "c3", outcome: "pass", credit: 1, confidence: 0.7 };
    const p = computeProposal(input);
    expect(p.blockedReason).toBe("low_confidence");
    expect(p.lowConfidenceCriteria).toEqual(["c3"]);
  });

  it("flags human confirmation above the threshold", () => {
    const p = computeProposal(bakery({ milestoneAmountMinor: 500_000 }));
    expect(p.captureMinor).toBe(375_000);
    expect(p.requiresHumanConfirm).toBe(true);
  });

  it("floors capture to protect the payer", () => {
    const p = computeProposal(bakery({ milestoneAmountMinor: 333 }));
    expect(p.captureMinor).toBe(249); // 333 × 0.75 = 249.75
  });

  it("rejects weights that do not sum to 100", () => {
    const input = bakery();
    input.criteria[0]!.weight = 30;
    expect(() => computeProposal(input)).toThrow(/sum to 105/);
  });

  it("rejects missing, duplicate and unknown results", () => {
    const missing = bakery();
    missing.results.pop();
    expect(() => computeProposal(missing)).toThrow(/Missing result/);
    const dup = bakery();
    dup.results.push({ ...dup.results[0]! });
    expect(() => computeProposal(dup)).toThrow(/Duplicate/);
    const unknown = bakery();
    unknown.results.push({ criterionId: "c9", outcome: "pass", credit: 1, confidence: 1 });
    expect(() => computeProposal(unknown)).toThrow(/unknown criterion/);
  });
});

describe("normaliseCreditPct", () => {
  it("clamps partial credit to 5..95", () => {
    expect(normaliseCreditPct("partial", 0.01, true)).toBe(5);
    expect(normaliseCreditPct("partial", 0.99, true)).toBe(95);
    expect(normaliseCreditPct("partial", Number.NaN, true)).toBe(5);
    expect(normaliseCreditPct("fail", 1, true)).toBe(0);
    expect(normaliseCreditPct("pass", 0, false)).toBe(100);
  });
});

/** Arbitrary well-formed settlement input. */
const arbInput = fc
  .integer({ min: 1, max: 8 })
  .chain((n) =>
    fc.record({
      amount: fc.integer({ min: 1, max: 100_000_000 }),
      cuts: fc.uniqueArray(fc.integer({ min: 1, max: 99 }), { minLength: n - 1, maxLength: n - 1 }),
      flags: fc.array(
        fc.record({
          required: fc.boolean(),
          partialCredit: fc.boolean(),
          outcome: fc.constantFrom("pass", "partial", "fail", "undetermined" as const),
          credit: fc.double({ min: 0, max: 1, noNaN: true }),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        { minLength: n, maxLength: n },
      ),
      injection: fc.boolean(),
      feeBps: fc.integer({ min: 0, max: 10000 }),
    }),
  )
  .map(({ amount, cuts, flags, injection, feeBps }) => {
    const sorted = [0, ...cuts.sort((a, b) => a - b), 100];
    const weights = flags.map((_, i) => sorted[i + 1]! - sorted[i]!);
    const input: SettlementInput = {
      milestoneAmountMinor: amount,
      criteria: flags.map((f, i) => ({
        id: `c${i + 1}`,
        weight: weights[i]!,
        required: f.required,
        partialCredit: f.partialCredit,
      })),
      results: flags.map((f, i) => ({
        criterionId: `c${i + 1}`,
        outcome: f.outcome,
        credit: f.credit,
        confidence: f.confidence,
      })),
      injectionFlagged: injection,
      policy: { ...policy, platformFeeBps: feeBps },
    };
    return input;
  });

describe("computeProposal properties", () => {
  it("never captures more than authorized, fee ≤ capture, bps in range", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const p = computeProposal(input);
        expect(p.captureMinor).toBeLessThanOrEqual(input.milestoneAmountMinor);
        expect(p.platformFeeMinor).toBeLessThanOrEqual(p.captureMinor);
        expect(p.releaseBps).toBeGreaterThanOrEqual(0);
        expect(p.releaseBps).toBeLessThanOrEqual(10000);
        expect(Number.isInteger(p.captureMinor)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("injection always blocks; blocked/zero never move money", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const p = computeProposal(input);
        if (input.injectionFlagged) expect(p.blockedReason).toBe("injection");
        if (p.kind !== "release") expect(p.captureMinor).toBe(0);
      }),
    );
  });

  it("a failed required criterion never releases money", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const p = computeProposal(input);
        const reqFailed = p.breakdown.some((c) => c.required && c.creditPct < 100);
        if (reqFailed) expect(p.captureMinor).toBe(0);
      }),
    );
  });
});

describe("computePayoutPlan", () => {
  it("pays the single worker net minus platform fee", () => {
    const plan = computePayoutPlan({
      capturedMinor: 30_000,
      netMinor: 28_920, // PayPal fee 10.80
      platformFeeBps: 150,
      recipients: [{ paypalEmail: "w@x.test", shareBps: 10000 }],
    });
    expect(plan.platformFeeMinor).toBe(450);
    expect(plan.distributableMinor).toBe(28_470);
    expect(plan.lines[0]!.amountMinor).toBe(28_470);
  });

  it("gives remainder cents to the first recipient", () => {
    const plan = computePayoutPlan({
      capturedMinor: 1000,
      netMinor: 1000,
      platformFeeBps: 0,
      recipients: [
        { paypalEmail: "a@x.test", shareBps: 3333 },
        { paypalEmail: "b@x.test", shareBps: 3333 },
        { paypalEmail: "c@x.test", shareBps: 3334 },
      ],
    });
    expect(plan.lines.map((l) => l.amountMinor)).toEqual([334, 333, 333]);
  });

  it("always distributes exactly the distributable amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 1, max: 5 }),
        (captured, feeBps, n) => {
          const base = Math.floor(10000 / n);
          const shares = Array.from({ length: n }, (_, i) => (i === 0 ? 10000 - base * (n - 1) : base));
          const plan = computePayoutPlan({
            capturedMinor: captured,
            netMinor: Math.floor(captured * 0.96),
            platformFeeBps: feeBps,
            recipients: shares.map((s, i) => ({ paypalEmail: `r${i}@x.test`, shareBps: s })),
          });
          expect(plan.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(plan.distributableMinor);
        },
      ),
    );
  });

  it("rejects bad shares and net > captured", () => {
    expect(() =>
      computePayoutPlan({ capturedMinor: 10, netMinor: 11, platformFeeBps: 0, recipients: [{ paypalEmail: "a", shareBps: 10000 }] }),
    ).toThrow();
    expect(() =>
      computePayoutPlan({ capturedMinor: 10, netMinor: 10, platformFeeBps: 0, recipients: [{ paypalEmail: "a", shareBps: 9000 }] }),
    ).toThrow(/10000/);
  });
});

describe("estimateMpesaKes", () => {
  it("applies rate and withdrawal fee", () => {
    expect(estimateMpesaKes(28_470, 129.5)).toBe(Math.floor(284.7 * 129.5 * 0.97));
  });
});
