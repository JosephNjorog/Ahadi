import { and, desc, eq, or } from "drizzle-orm";
import { anthropicConfigured, conciergeDecide } from "@ahadi/agents";
import { formatMoney } from "@ahadi/core";
import { estimateMpesaKes } from "@ahadi/core/settlement";
import { getEnv } from "@ahadi/core/env";
import { getDb, milestones, promises, users, whatsappMessages } from "@ahadi/db";
import { enqueue } from "@ahadi/queue";
import { log } from "./log";
import { submitWork } from "./verification";
import { sendWhatsAppText } from "./whatsapp-api";

/** WhatsApp Cloud API inbound (SPEC §18): store → concierge job → execute with web-equivalent checks. */

interface InboundPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: { id: string; from: string; type: string; text?: { body: string } }[];
        contacts?: { profile?: { name?: string } }[];
      };
    }[];
  }[];
}

export async function ingestWhatsApp(body: InboundPayload) {
  const db = getDb();
  let queued = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type !== "text" || !msg.text?.body) continue;
        const phone = `+${msg.from.replace(/^\+/, "")}`;
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phoneE164, phone));
        const [row] = await db
          .insert(whatsappMessages)
          .values({
            userId: u?.id ?? null,
            phoneE164: phone,
            direction: "in",
            body: msg.text.body.slice(0, 4000),
            waMessageId: msg.id,
          })
          .onConflictDoNothing({ target: whatsappMessages.waMessageId })
          .returning();
        if (row) {
          await enqueue("whatsapp.inbound", { messageId: row.id });
          queued++;
        }
      }
    }
  }
  return queued;
}

const PIN_OR_SECRET = /\b(pin|password|passcode|otp|cvv)\b.{0,20}\d{3,}|\b\d{4}\b.{0,10}\b(pin|password)\b/i;

export async function handleWhatsAppMessage(messageId: string) {
  const db = getDb();
  const env = getEnv();
  const [msg] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
  if (!msg || msg.action) return "already_handled";
  const base = env.APP_URL.replace(/\/$/, "");
  const reply = async (text: string, action: unknown) => {
    await db
      .update(whatsappMessages)
      .set({ action: action as Record<string, unknown> })
      .where(eq(whatsappMessages.id, messageId));
    await sendWhatsAppText(msg.phoneE164, text, msg.userId);
    return text;
  };
  if (!msg.userId)
    return reply(
      `Hi! This number isn't linked to an Ahadi account yet. Add it in Settings: ${base}/settings`,
      { action: "unknown_user" },
    );
  // Code-level guard before any model sees it (AGENT_PROMPTS §13 concierge test).
  if (PIN_OR_SECRET.test(msg.body))
    return reply(
      "Please delete that message. Never share PINs or passwords with anyone, including Ahadi. Payments and signatures only happen on the secure Ahadi website.",
      { action: "secret_warning" },
    );

  const [u] = await db.select().from(users).where(eq(users.id, msg.userId));
  const list = await db
    .select()
    .from(promises)
    .where(or(eq(promises.clientUserId, u!.id), eq(promises.workerUserId, u!.id)))
    .orderBy(desc(promises.updatedAt))
    .limit(10);
  const ms = list.length ? await db.select().from(milestones) : [];
  const summary = list.map((p) => ({
    id: p.id,
    title: p.title,
    role: p.clientUserId === u!.id ? "client" : "worker",
    state: p.state,
    milestones: ms
      .filter((m) => m.promiseId === p.id)
      .map((m) => ({
        position: m.position,
        title: m.title,
        state: m.state,
        amount: formatMoney(m.amountMinor, p.currency),
        mpesaEstimateKes:
          p.currency === "USD" ? estimateMpesaKes(Math.floor(m.amountMinor * 0.97), env.KES_PER_USD) : null,
      })),
  }));
  if (!anthropicConfigured()) {
    return reply(
      `Your promises:\n${summary.map((p) => `• ${p.title} — ${p.state}`).join("\n") || "none yet"}\nOpen Ahadi: ${base}/dashboard`,
      { action: "help", ai: false },
    );
  }
  const history = await db
    .select()
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.phoneE164, msg.phoneE164)))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(8);
  const decision = await conciergeDecide({
    messageId,
    userName: u!.displayName,
    language: "the user's language (English or Swahili)",
    promises: summary,
    history: history
      .reverse()
      .map((h) => `${h.direction === "in" ? "User" : "Ahadi"}: ${h.body}`)
      .join("\n"),
    message: msg.body,
  });

  // Execute with the same authorization checks as the web; links replace any confirmation in chat.
  const p = list.find((x) => x.id === decision.promiseId);
  const link = p ? `${base}/promises/${p.id}` : `${base}/dashboard`;
  let text = decision.reply;
  if (decision.action === "accept_terms" && p) text = `${decision.reply}\nReview and sign securely: ${link}`;
  if (decision.action === "decision_link" && p)
    text = `${decision.reply}\nDecide here: ${base}/promises/${p.id}/verify`;
  if (decision.action === "submit_link" && p && decision.submittedUrl && decision.milestone) {
    const m = ms.find((x) => x.promiseId === p.id && x.position === decision.milestone);
    if (!m || p.workerUserId !== u!.id)
      text = "I can only submit work for a funded milestone where you're the worker.";
    else {
      try {
        const kind = p.category === "code" ? null : "url";
        if (!kind)
          text = `Code needs a repository and commit SHA. Submit here: ${base}/promises/${p.id}/submit?milestone=${m.id}`;
        else {
          await submitWork({ kind: "user", user: u! }, m.id, {
            kind: "url",
            url: decision.submittedUrl,
            note: "Submitted via WhatsApp",
          });
          text = `Got it — verification has started for "${m.title}". Watch it live: ${base}/promises/${p.id}/verify?milestone=${m.id}`;
        }
      } catch (e) {
        text = `I couldn't submit that: ${(e as Error).message}`;
      }
    }
  }
  if (decision.action === "view_promise" && p) text = `${decision.reply}\n${link}`;
  log.info({ wa_message: messageId, action: decision.action }, "concierge handled message");
  return reply(text.slice(0, 1500), decision);
}
