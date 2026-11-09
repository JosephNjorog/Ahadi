import { describe, expect, it } from "vitest";
import { settleWithin } from "../src/browser";

describe("settleWithin", () => {
  it("returns true when the step finishes in time", async () => {
    expect(await settleWithin(Promise.resolve(), 50)).toBe(true);
  });

  it("returns true when the step rejects in time (teardown errors are ignored)", async () => {
    expect(await settleWithin(Promise.reject(new Error("already closed")), 50)).toBe(true);
  });

  it("gives up and returns false when the step never finishes", async () => {
    const started = Date.now();
    expect(await settleWithin(new Promise(() => undefined), 30)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
