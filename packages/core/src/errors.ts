/**
 * Error codes shared by every surface (web API, MCP, WhatsApp). The HTTP layer maps
 * them to status codes; the MCP layer returns them as structured tool errors.
 */
export const ERROR_CODES = {
  ILLEGAL_TRANSITION: 409,
  TERMS_HASH_MISMATCH: 409,
  CONFLICT: 409,
  MANDATE_EXCEEDED: 403,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  PAYPAL_ERROR: 502,
  CONFIG_MISSING: 500,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export class IllegalTransitionError extends AppError {
  constructor(machine: string, from: string, event: string) {
    super("ILLEGAL_TRANSITION", `${machine}: cannot apply ${event} in state ${from}`, { machine, from, event });
    this.name = "IllegalTransitionError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Invariant check that survives production builds (unlike console.assert). */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AppError("INTERNAL", `Invariant violated: ${message}`);
}
