import { canonicalJson, sha256Hex } from "@ahadi/core";

/**
 * Pure hash-chain functions (SPEC §11.2).
 *   hash = sha256(prev_hash \n seq \n type \n canonical_json(payload) \n created_at_iso)
 *   prev_hash for seq 1 = sha256("ahadi:genesis:" + promise_id)
 */

export interface ChainEvent {
  promiseId: string;
  seq: number;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  createdAt: Date;
}

export function genesisHash(promiseId: string): string {
  return sha256Hex(`ahadi:genesis:${promiseId}`);
}

export function computeEventHash(e: Omit<ChainEvent, "hash" | "promiseId" | "actor"> & { actor?: string }): string {
  return sha256Hex(
    [e.prevHash, String(e.seq), e.type, canonicalJson(e.payload), e.createdAt.toISOString()].join("\n"),
  );
}

export type ChainVerification =
  | { valid: true; length: number; headHash: string }
  | { valid: false; length: number; brokenAt: number; reason: string };

export function verifyChain(promiseId: string, events: ChainEvent[]): ChainVerification {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let prev = genesisHash(promiseId);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.seq !== i + 1) return { valid: false, length: sorted.length, brokenAt: e.seq, reason: "sequence gap" };
    if (e.promiseId !== promiseId)
      return { valid: false, length: sorted.length, brokenAt: e.seq, reason: "event from another promise" };
    if (e.prevHash !== prev)
      return { valid: false, length: sorted.length, brokenAt: e.seq, reason: "prev_hash does not match" };
    const expected = computeEventHash(e);
    if (expected !== e.hash)
      return { valid: false, length: sorted.length, brokenAt: e.seq, reason: "event contents were altered" };
    prev = e.hash;
  }
  return { valid: true, length: sorted.length, headHash: prev };
}
