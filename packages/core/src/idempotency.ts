/**
 * Deterministic PayPal idempotency keys (SPEC §6.2). Retries reuse the same key, so
 * PayPal returns the original result instead of charging or paying twice.
 * PayPal-Request-Id allows up to 108 characters.
 */
export const idempotencyKeys = {
  createOrder: (milestoneId: string, fundingAttempt: number) =>
    `ahadi:order:${milestoneId}:${fundingAttempt}`,
  authorizeOrder: (paypalOrderId: string) => `ahadi:auth:${paypalOrderId}`,
  reauthorize: (authorizationId: string) => `ahadi:reauth:${authorizationId}`,
  capture: (proposalId: string) => `ahadi:capture:${proposalId}`,
  void: (authorizationId: string) => `ahadi:void:${authorizationId}`,
  refund: (mediationId: string) => `ahadi:refund:${mediationId}`,
  /** Payouts dedupe on sender_batch_id (max 127 chars, no colons for readability). */
  payoutBatch: (settlementId: string) => `ahadi_po_${settlementId.replace(/-/g, "")}`,
  payoutItem: (settlementId: string, index: number) => `ahadi_po_${settlementId.replace(/-/g, "")}_${index}`,
} as const;
