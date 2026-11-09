import { getEnv } from "@ahadi/core/env";
import { log } from "./log";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends through Resend when RESEND_API_KEY is set; otherwise logs the message (local dev). */
export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean }> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    log.info({ to: msg.to, subject: msg.subject, text: msg.text }, "email (dev — not sent, RESEND_API_KEY empty)");
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) {
    log.error({ to: msg.to, status: res.status, body: await res.text() }, "email send failed");
    return { delivered: false };
  }
  return { delivered: true };
}
