import pino from "pino";

/** Structured JSON logs (SPEC §24): include promise_id, milestone_id, job_id, paypal_debug_id where relevant. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.AHADI_SERVICE ?? "ahadi" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ["*.authorization", "*.password", "*.token", "*.secret"], remove: true },
});
