import { getDb, whatsappMessages } from "@ahadi/db";
import { log } from "./log";

/** WhatsApp Cloud API (SPEC §18). */
const GRAPH = "https://graph.facebook.com/v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Free-form text works inside the 24h customer-service window; outside it Meta requires an
 * approved template, so we fall back to the template named after our notification template.
 */
export async function sendWhatsAppText(
  toE164: string,
  body: string,
  userId?: string | null,
  template?: string,
): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const to = toE164.replace(/^\+/, "");
  const payload = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name: template, language: { code: "en" } },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: body.slice(0, 4000), preview_url: true },
      };
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    log.warn({ status: res.status, err: json.error?.message }, "whatsapp send failed");
    return false;
  }
  await getDb()
    .insert(whatsappMessages)
    .values({
      userId: userId ?? null,
      phoneE164: toE164,
      direction: "out",
      body,
      waMessageId: json.messages?.[0]?.id ?? null,
    })
    .onConflictDoNothing();
  return true;
}
