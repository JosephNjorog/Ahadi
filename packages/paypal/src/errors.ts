export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue?: string;
  description?: string;
}

/** Normalised PayPal REST error (SPEC §6.1). */
export class PayPalError extends Error {
  readonly status: number;
  /** PayPal's error name, e.g. UNPROCESSABLE_ENTITY, RESOURCE_NOT_FOUND, or NETWORK_ERROR. */
  readonly paypalName: string;
  readonly debugId: string | undefined;
  readonly details: PayPalErrorDetail[];
  readonly retryable: boolean;
  readonly operation: string;

  constructor(args: {
    status: number;
    name: string;
    message: string;
    debugId?: string;
    details?: PayPalErrorDetail[];
    operation: string;
  }) {
    super(`PayPal ${args.operation} failed (${args.status} ${args.name}): ${args.message}`);
    this.name = "PayPalError";
    this.status = args.status;
    this.paypalName = args.name;
    this.debugId = args.debugId;
    this.details = args.details ?? [];
    this.operation = args.operation;
    this.retryable = isRetryableStatus(args.status) || args.name === "NETWORK_ERROR";
  }

  /** First issue code in details, e.g. AUTHORIZATION_ALREADY_CAPTURED. */
  get issue(): string | undefined {
    return this.details.find((d) => d.issue)?.issue;
  }

  hasIssue(issue: string): boolean {
    return this.details.some((d) => d.issue === issue);
  }

  toJSON() {
    return {
      status: this.status,
      name: this.paypalName,
      message: this.message,
      debugId: this.debugId,
      details: this.details,
      operation: this.operation,
      retryable: this.retryable,
    };
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isPayPalError(e: unknown): e is PayPalError {
  return e instanceof PayPalError;
}
