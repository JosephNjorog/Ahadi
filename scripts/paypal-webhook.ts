/**
 * npm run paypal:webhook — registers ${APP_URL}/api/webhooks/paypal for the sandbox app with all
 * events Ahadi handles (SPEC §6.7). Idempotent: updates the event list if the URL already exists.
 * Prints the webhook id to put in PAYPAL_WEBHOOK_ID.
 */
import { config } from "dotenv";
config();

const { PayPalClient, SUBSCRIBED_EVENTS, createWebhook, listWebhooks, updateWebhookEvents } =
  await import("@ahadi/paypal");

const appUrl = (process.argv[2] ?? process.env.APP_URL ?? "").replace(/\/$/, "");
if (!appUrl.startsWith("https://")) {
  console.error(`PayPal only delivers webhooks to public HTTPS URLs. APP_URL is "${appUrl}".`);
  console.error("Use your Render URL, or a tunnel: npx cloudflared tunnel --url http://localhost:3000");
  process.exit(1);
}
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET first.");
  process.exit(1);
}

const client = new PayPalClient({
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  env: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
  logger: { info() {}, warn() {}, error: (o, m) => console.error(m, o) },
});

const url = `${appUrl}/api/webhooks/paypal`;
const { data } = await listWebhooks(client);
const existing = data.webhooks?.find((w) => w.url === url);

if (existing) {
  await updateWebhookEvents(client, existing.id, SUBSCRIBED_EVENTS);
  console.log(`Updated existing webhook ${existing.id} → ${url} (${SUBSCRIBED_EVENTS.length} events)`);
  console.log(`\nPAYPAL_WEBHOOK_ID=${existing.id}`);
} else {
  const { data: created } = await createWebhook(client, url, SUBSCRIBED_EVENTS);
  console.log(`Created webhook ${created.id} → ${url} (${SUBSCRIBED_EVENTS.length} events)`);
  console.log(`\nPAYPAL_WEBHOOK_ID=${created.id}`);
}
const others = (data.webhooks ?? []).filter((w) => w.url !== url);
if (others.length)
  console.log(`\nOther webhooks on this app: ${others.map((w) => `${w.id} ${w.url}`).join(", ")}`);
console.log("\nPut PAYPAL_WEBHOOK_ID in .env (and in Render's ahadi-secrets group), then restart.");
