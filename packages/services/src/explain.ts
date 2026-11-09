import { bpsToPercent, formatMoney, type ComputedProposal } from "@ahadi/core";

/**
 * Deterministic explanation used until the Settlement Explainer agent (Phase 3) is wired in,
 * and as its fallback if the model output fails the "no new amounts" check.
 */
export function templateExplanation(args: {
  proposal: ComputedProposal;
  amountMinor: number;
  currency: string;
  titles: Record<string, string>;
}): string {
  const { proposal: p, amountMinor, currency, titles } = args;
  const passed = p.breakdown.filter((c) => c.creditPct === 100).map((c) => titles[c.id] ?? c.id);
  const partial = p.breakdown.filter((c) => c.creditPct > 0 && c.creditPct < 100).map((c) => `${titles[c.id] ?? c.id} (${c.creditPct}%)`);
  const failed = p.breakdown.filter((c) => c.creditPct === 0).map((c) => titles[c.id] ?? c.id);
  const total = p.breakdown.length;

  if (p.kind === "blocked") {
    const why =
      p.blockedReason === "injection"
        ? "the deliverable contains text that tries to manipulate the verifier"
        : p.blockedReason === "undetermined"
          ? "at least one criterion could not be decided from the evidence"
          : `confidence was too low on ${p.lowConfidenceCriteria.join(", ")}`;
    return `No money moves yet: ${why}. A human reviewer will decide the blocked criteria.`;
  }
  if (p.kind === "zero") {
    const req = p.breakdown.filter((c) => c.required && c.creditPct < 100).map((c) => titles[c.id] ?? c.id);
    return p.blockedReason === "required_failed"
      ? `Nothing is released because a required criterion was not met: ${req.join(", ")}. The hold will be voided unless the worker resubmits or objects.`
      : `None of the ${total} criteria were met, so nothing is released.`;
  }
  const parts = [
    `${passed.length} of ${total} criteria verified; ${bpsToPercent(p.releaseBps)} released = ${formatMoney(p.captureMinor, currency)} of ${formatMoney(amountMinor, currency)}.`,
  ];
  if (passed.length) parts.push(`Met: ${passed.join(", ")}.`);
  if (partial.length) parts.push(`Partly met: ${partial.join(", ")}.`);
  if (failed.length) parts.push(`Not met: ${failed.join(", ")}.`);
  if (p.captureMinor < amountMinor) parts.push(`The remaining ${formatMoney(amountMinor - p.captureMinor, currency)} is released back to the client.`);
  return parts.join(" ");
}
