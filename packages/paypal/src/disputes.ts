import type { PayPalClient } from "./client";
import type { Dispute } from "./types";

/** Disputes v1 (SPEC §6.8, stretch). */

export async function getDispute(client: PayPalClient, disputeId: string) {
  return client.request<Dispute>({
    operation: "disputes.get",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}`,
  });
}

/** Multipart: JSON evidence descriptor + the Ahadi evidence-pack PDF. */
export async function provideDisputeEvidence(
  client: PayPalClient,
  disputeId: string,
  args: { notes: string; pdf: Uint8Array; fileName: string },
) {
  const form = new FormData();
  form.append(
    "input",
    new Blob(
      [
        JSON.stringify({
          evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: args.notes.slice(0, 2000) }],
        }),
      ],
      {
        type: "application/json",
      },
    ),
  );
  form.append("file1", new Blob([args.pdf as BlobPart], { type: "application/pdf" }), args.fileName);
  return client.request<Record<string, unknown>>({
    operation: "disputes.provideEvidence",
    path: `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`,
    formData: form,
  });
}
