import { NextResponse } from "next/server";
import { signingPublicKey } from "@ahadi/services";

export const runtime = "nodejs";

/** SPEC §15: Ahadi's Ed25519 public key so banks and reviewers can verify statements. */
export function GET() {
  const k = signingPublicKey();
  return NextResponse.json(
    {
      keys: [{ ...k.jwk, kid: k.kid, alg: k.alg, use: "sig" }],
      pem: k.pem,
      howToVerify:
        "Ed25519 signature (base64url) over the canonical JSON (sorted keys, no whitespace) of the statement's `doc`.",
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
