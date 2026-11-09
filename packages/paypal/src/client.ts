import { PayPalError, isRetryableStatus, type PayPalErrorDetail } from "./errors";

export type PayPalEnv = "sandbox" | "live";

export const PAYPAL_BASE_URL: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export interface PayPalLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

const jsonLogger: PayPalLogger = {
  info: (o, m) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o, m) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })),
  error: (o, m) => console.error(JSON.stringify({ level: "error", msg: m, ...o })),
};

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  env?: PayPalEnv;
  /** Injected for tests. */
  fetch?: typeof fetch;
  logger?: PayPalLogger;
  /** Max attempts for retryable failures (network, 408, 429, 5xx). Writes are safe to retry: they carry PayPal-Request-Id. */
  maxAttempts?: number;
  /** Base backoff in ms (doubles each attempt). */
  backoffMs?: number;
  timeoutMs?: number;
  /** BN code for partner attribution (multiparty, SPEC §6.10). */
  partnerAttributionId?: string;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  /** Logged and used in error messages, e.g. "orders.create". */
  operation: string;
  body?: unknown;
  /** Pre-serialised JSON (webhook verification must embed the raw event body verbatim). */
  rawJsonBody?: string;
  formData?: FormData;
  requestId?: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** Accept these statuses as success with an empty body (e.g. 204, 202). */
  allowEmpty?: boolean;
}

export interface PayPalResponse<T> {
  data: T;
  status: number;
  debugId: string | undefined;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class PayPalClient {
  readonly env: PayPalEnv;
  readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: PayPalLogger;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly timeoutMs: number;
  private readonly partnerAttributionId: string | undefined;
  private token: CachedToken | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(opts: PayPalClientOptions) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error("PayPal client id and secret are required. See docs/SETUP.md → PayPal.");
    }
    this.env = opts.env ?? "sandbox";
    this.baseUrl = PAYPAL_BASE_URL[this.env];
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.logger = opts.logger ?? jsonLogger;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 400;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.partnerAttributionId = opts.partnerAttributionId;
  }

  /* ─────────────── OAuth (client credentials) ─────────────── */

  /** Cached until expires_in − 60s; concurrent callers share one in-flight request. */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.accessToken;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.fetchToken().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  invalidateToken() {
    this.token = null;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new PayPalError({ status: 0, name: "NETWORK_ERROR", message: String(e), operation: "oauth.token" });
    }
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new PayPalError({
        status: res.status,
        name: body.error ?? "AUTHENTICATION_FAILURE",
        message: body.error_description ?? "Could not obtain PayPal access token — check PAYPAL_CLIENT_ID / SECRET and PAYPAL_ENV",
        debugId,
        operation: "oauth.token",
      });
    }
    const ttlMs = Math.max(0, ((body.expires_in ?? 300) - 60) * 1000);
    this.token = { accessToken: body.access_token, expiresAt: Date.now() + ttlMs };
    return body.access_token;
  }

  /* ─────────────── Generic request ─────────────── */

  async request<T>(opts: RequestOptions): Promise<PayPalResponse<T>> {
    const method = opts.method ?? (opts.body !== undefined || opts.rawJsonBody || opts.formData ? "POST" : "GET");
    const url = new URL(opts.path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    let lastError: PayPalError | undefined;
    let refreshedToken = false;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const token = await this.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      let body: BodyInit | undefined;
      if (opts.formData) {
        body = opts.formData;
      } else if (opts.rawJsonBody !== undefined || opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = opts.rawJsonBody ?? JSON.stringify(opts.body);
      }
      if (method !== "GET") headers.Prefer = "return=representation";
      if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
      if (this.partnerAttributionId) headers["PayPal-Partner-Attribution-Id"] = this.partnerAttributionId;

      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        lastError = new PayPalError({ status: 0, name: "NETWORK_ERROR", message: String(e), operation: opts.operation });
        this.logger.warn({ op: opts.operation, attempt, err: String(e) }, "paypal network error");
        if (attempt < this.maxAttempts) await sleep(this.backoffMs * 2 ** (attempt - 1));
        continue;
      }

      const debugId = res.headers.get("paypal-debug-id") ?? undefined;
      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      const logBase = { op: opts.operation, status: res.status, paypal_debug_id: debugId, ms: Date.now() - started, attempt };

      if (res.ok) {
        this.logger.info(logBase, "paypal ok");
        if (parsed === undefined && !opts.allowEmpty && text) {
          throw new PayPalError({ status: res.status, name: "INVALID_RESPONSE", message: "Non-JSON response", debugId, operation: opts.operation });
        }
        return { data: (parsed ?? {}) as T, status: res.status, debugId };
      }

      // Expired/revoked token: refresh once and retry immediately.
      if (res.status === 401 && !refreshedToken) {
        refreshedToken = true;
        this.invalidateToken();
        attempt--;
        continue;
      }

      const err = toPayPalError(res.status, parsed, debugId, opts.operation);
      this.logger.warn({ ...logBase, name: err.paypalName, issue: err.issue }, "paypal error");
      lastError = err;
      if (!isRetryableStatus(res.status) || attempt >= this.maxAttempts) throw err;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs * 2 ** (attempt - 1));
    }
    throw lastError ?? new PayPalError({ status: 0, name: "UNKNOWN", message: "exhausted retries", operation: opts.operation });
  }
}

function toPayPalError(status: number, body: unknown, debugId: string | undefined, operation: string): PayPalError {
  const b = (body ?? {}) as {
    name?: string;
    message?: string;
    debug_id?: string;
    details?: PayPalErrorDetail[];
    error?: string;
    error_description?: string;
  };
  return new PayPalError({
    status,
    name: b.name ?? b.error ?? `HTTP_${status}`,
    message: b.message ?? b.error_description ?? "Request failed",
    debugId: b.debug_id ?? debugId,
    details: Array.isArray(b.details) ? b.details : [],
    operation,
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
