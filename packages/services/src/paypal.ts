import { AppError } from "@ahadi/core";
import { getEnv, paypalConfigured } from "@ahadi/core/env";
import { PayPalClient } from "@ahadi/paypal";
import { log } from "./log";

type Global = typeof globalThis & { __ahadiPayPal?: PayPalClient };
const g = globalThis as Global;

let injected: PayPalClient | undefined;

/** Tests inject a client backed by a fake fetch. */
export function setPayPalClient(client: PayPalClient | undefined) {
  injected = client;
}

export function getPayPal(): PayPalClient {
  if (injected) return injected;
  if (g.__ahadiPayPal) return g.__ahadiPayPal;
  const env = getEnv();
  if (!paypalConfigured(env)) {
    throw new AppError(
      "CONFIG_MISSING",
      "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (docs/SETUP.md).",
    );
  }
  g.__ahadiPayPal = new PayPalClient({
    clientId: env.PAYPAL_CLIENT_ID!,
    clientSecret: env.PAYPAL_CLIENT_SECRET!,
    env: env.PAYPAL_ENV,
    logger: {
      info: (o, m) => log.info(o, m),
      warn: (o, m) => log.warn(o, m),
      error: (o, m) => log.error(o, m),
    },
  });
  return g.__ahadiPayPal;
}
