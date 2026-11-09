import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";

/**
 * Ahadi's Ed25519 signing key for source-of-funds statements (SPEC §15). Set AHADI_SIGNING_KEY to a
 * PKCS#8 PEM in production; otherwise a stable key is derived from SESSION_SECRET (HKDF-style),
 * so the published public key survives restarts.
 */
let cached: { priv: KeyObject; pub: KeyObject } | null = null;

function keys() {
  if (cached) return cached;
  const pem = process.env.AHADI_SIGNING_KEY?.replace(/\\n/g, "\n");
  let priv: KeyObject;
  if (pem) priv = createPrivateKey(pem);
  else {
    const seed = createHmac("sha256", getEnv().SESSION_SECRET)
      .update("ahadi:ed25519:statement-signing:v1")
      .digest();
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
    priv = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  }
  cached = { priv, pub: createPublicKey(priv) };
  return cached;
}

export function signingPublicKey() {
  const { pub } = keys();
  const jwk = pub.export({ format: "jwk" });
  const pem = pub.export({ format: "pem", type: "spki" }).toString();
  const kid = createHash("sha256").update(pem).digest("hex").slice(0, 16);
  return { kid, alg: "EdDSA", crv: "Ed25519", jwk, pem };
}

export function signDocument(doc: unknown) {
  const payload = canonicalJson(doc);
  const signature = sign(null, Buffer.from(payload), keys().priv).toString("base64url");
  return { payload, signature, kid: signingPublicKey().kid };
}

export function verifyDocument(doc: unknown, signature: string): boolean {
  return verify(null, Buffer.from(canonicalJson(doc)), keys().pub, Buffer.from(signature, "base64url"));
}
