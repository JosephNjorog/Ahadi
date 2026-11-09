import { and, desc, eq, isNull } from "drizzle-orm";
import { getEnv } from "@ahadi/core/env";
import { getDb, notifications, users } from "@ahadi/db";
import { enqueue } from "@ahadi/queue";
import { sendEmail } from "./email";
import { log } from "./log";
import { sendWhatsAppText, whatsappConfigured } from "./whatsapp-api";

export type Template =
  | "job_offer"
  | "terms_ready"
  | "terms_signed"
  | "funds_secured"
  | "work_submitted"
  | "verdict_ready"
  | "needs_review"
  | "payment_sent"
  | "hold_expiring"
  | "mediation_update"
  | "settlement_failed"
  | "generic";

/**
 * notify (SPEC §17 notify.send): store an in-app notification, then deliver by email and,
 * when the user has a phone and WhatsApp is configured, by WhatsApp. Never throws on delivery.
 */
export async function notify(args: {
  userId: string | null | undefined;
  template: Template;
  title: string;
  body: string;
  link?: string;
  promiseId?: string;
}) {
  if (!args.userId) return;
  const [u] = await getDb().select({ phone: users.phoneE164 }).from(users).where(eq(users.id, args.userId));
  if (!u) return;
  const channels = ["inapp", "email", ...(u.phone ? ["whatsapp"] : [])];
  const [n] = await getDb()
    .insert(notifications)
    .values({
      userId: args.userId,
      template: args.template,
      title: args.title,
      body: args.body,
      link: args.link ?? null,
      promiseId: args.promiseId ?? null,
      channels,
    })
    .returning();
  await enqueue("notify.send", { notificationId: n!.id }).catch((e) =>
    log.warn({ err: String(e) }, "could not enqueue notification"),
  );
}

export async function deliverNotification(notificationId: string) {
  const db = getDb();
  const [n] = await db.select().from(notifications).where(eq(notifications.id, notificationId));
  if (!n || n.deliveries) return "already_delivered";
  const [u] = await db.select().from(users).where(eq(users.id, n.userId));
  if (!u) return "no_user";
  const base = getEnv().APP_URL.replace(/\/$/, "");
  const url = n.link ? `${base}${n.link}` : base;
  const deliveries: Record<string, string> = {};
  if (n.channels.includes("email")) {
    const r = await sendEmail({
      to: u.email,
      subject: n.title,
      text: `${n.body}\n\n${url}\n\n— Ahadi`,
      html: `<p>${escapeHtml(n.body)}</p><p><a href="${url}">Open in Ahadi</a></p>`,
    });
    deliveries.email = r.delivered ? "sent" : "logged";
  }
  if (n.channels.includes("whatsapp") && u.phoneE164) {
    if (whatsappConfigured()) {
      const ok = await sendWhatsAppText(u.phoneE164, `*${n.title}*\n${n.body}\n${url}`, u.id).catch(
        () => false,
      );
      deliveries.whatsapp = ok ? "sent" : "failed";
    } else deliveries.whatsapp = "not_configured";
  }
  await db.update(notifications).set({ deliveries }).where(eq(notifications.id, n.id));
  return deliveries;
}

export async function listNotifications(userId: string, limit = 30) {
  return getDb()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationsRead(userId: string) {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
