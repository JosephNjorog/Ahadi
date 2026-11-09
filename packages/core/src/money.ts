import { AppError } from "./errors";

/**
 * Money is stored and computed as integer minor units (cents) everywhere.
 * Conversion to PayPal's 2-decimal string happens only at the API boundary.
 */

const TWO_DECIMAL_CURRENCIES = new Set(["USD", "EUR", "GBP", "KES", "CAD", "AUD"]);

function assertSupported(currency: string) {
  if (!TWO_DECIMAL_CURRENCIES.has(currency)) {
    throw new AppError("VALIDATION_FAILED", `Unsupported currency ${currency}`);
  }
}

export function assertMinor(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError("VALIDATION_FAILED", `${label} must be a non-negative safe integer of minor units`, {
      value,
    });
  }
}

/** 40000 → "400.00" */
export function toPayPalValue(minor: number, currency = "USD"): string {
  assertSupported(currency);
  assertMinor(minor);
  const whole = Math.floor(minor / 100);
  const cents = minor % 100;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

/** "286.53" → 28653. Rejects anything that is not a plain decimal with ≤ 2 places. */
export function fromPayPalValue(value: string, currency = "USD"): number {
  assertSupported(currency);
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new AppError("VALIDATION_FAILED", `Not a valid money value: ${value}`);
  const whole = Number(m[1]);
  const cents = Number((m[2] ?? "0").padEnd(2, "0"));
  const minor = whole * 100 + cents;
  assertMinor(minor);
  return minor;
}

/** 40000, "USD" → "$400.00" */
export function formatMoney(minor: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

/** Dollars (as typed by a human or agent) → minor units, rounded to the cent. */
export function dollarsToMinor(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars < 0) {
    throw new AppError("VALIDATION_FAILED", "Amount must be a non-negative number");
  }
  return Math.round(dollars * 100);
}

/** floor(amount * bps / 10000) using integer math only. */
export function applyBps(minor: number, bps: number): number {
  assertMinor(minor);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new AppError("VALIDATION_FAILED", `bps out of range: ${bps}`);
  }
  const product = minor * bps;
  if (!Number.isSafeInteger(product)) {
    return Number((BigInt(minor) * BigInt(bps)) / 10000n);
  }
  return Math.floor(product / 10000);
}

export function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}
