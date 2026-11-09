import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Criterion } from "@ahadi/core";
import { rebalanceWeights } from "../src/contracts";

const c = (id: string, weight: number): Criterion => ({
  id,
  title: id,
  description: id,
  weight,
  required: false,
  method: "ai_judgment",
  evidence: ["dom_snapshot"],
  partialCredit: false,
});

describe("rebalanceWeights", () => {
  it("keeps the fixed weight and scales the rest to 100", () => {
    const out = rebalanceWeights([c("c1", 25), c("c2", 25), c("c3", 25), c("c4", 40)], "c4");
    expect(out.find((x) => x.id === "c4")!.weight).toBe(40);
    expect(out.reduce((s, x) => s + x.weight, 0)).toBe(100);
    expect(out.map((x) => x.weight)).toEqual([20, 20, 20, 40]);
  });

  it("always sums to 100 with every weight ≥ 1", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 8 }),
        fc.nat(),
        (ws, pick) => {
          const list = ws.map((w, i) => c(`c${i + 1}`, w));
          const fixed = list[pick % list.length]!.id;
          const out = rebalanceWeights(list, fixed);
          expect(out.reduce((s, x) => s + x.weight, 0)).toBe(100);
          expect(out.every((x) => x.weight >= 1)).toBe(true);
        },
      ),
    );
  });
});
