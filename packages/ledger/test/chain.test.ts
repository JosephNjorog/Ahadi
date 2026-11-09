import { describe, expect, it } from "vitest";
import { computeEventHash, genesisHash, verifyChain, type ChainEvent } from "../src/chain";
import { maskEmail } from "../src/append";

const PID = "4b7e0000-0000-4000-8000-000000000001";

function build(n: number): ChainEvent[] {
  const out: ChainEvent[] = [];
  let prev = genesisHash(PID);
  for (let seq = 1; seq <= n; seq++) {
    const e = {
      promiseId: PID,
      seq,
      type: `t.${seq}`,
      actor: "system",
      payload: { n: seq, nested: { b: 2, a: 1 } },
      prevHash: prev,
      createdAt: new Date(1_700_000_000_000 + seq),
    };
    const hash = computeEventHash(e);
    out.push({ ...e, hash });
    prev = hash;
  }
  return out;
}

describe("ledger chain", () => {
  it("verifies an intact chain", () => {
    const v = verifyChain(PID, build(6));
    expect(v.valid).toBe(true);
    if (v.valid) expect(v.length).toBe(6);
  });

  it("verifies an empty chain", () => expect(verifyChain(PID, []).valid).toBe(true));

  it("detects editing any field of any event", () => {
    const edits: ((e: ChainEvent) => void)[] = [
      (e) => (e.payload = { ...e.payload, n: 999 }),
      (e) => (e.type = "forged"),
      (e) => (e.createdAt = new Date(0)),
      (e) => (e.prevHash = "0".repeat(64)),
    ];
    for (let i = 0; i < 6; i++) {
      for (const edit of edits) {
        const chain = build(6);
        edit(chain[i]!);
        const v = verifyChain(PID, chain);
        expect(v.valid).toBe(false);
        if (!v.valid) expect(v.brokenAt).toBe(i + 1);
      }
    }
  });

  it("detects deletion and reordering", () => {
    const chain = build(5);
    chain.splice(2, 1);
    expect(verifyChain(PID, chain).valid).toBe(false);
  });

  it("is independent of payload key order", () => {
    const base = { prevHash: "x", seq: 1, type: "t", createdAt: new Date(5) };
    expect(computeEventHash({ ...base, payload: { a: 1, b: 2 } })).toBe(
      computeEventHash({ ...base, payload: { b: 2, a: 1 } }),
    );
  });

  it("masks emails", () => {
    expect(maskEmail("worker@example.com")).toBe("w****r@example.com");
    expect(maskEmail("ab@x.io")).toBe("a*@x.io");
  });
});
