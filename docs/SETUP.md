# Ahadi — Setup guide

Everything you need to run Ahadi against **Neon Postgres** and the **PayPal sandbox**, locally and on Render.
Follow it top to bottom the first time; each section ends with a check so you know it worked.

- [1. Prerequisites](#1-prerequisites)
- [2. Neon database](#2-neon-database)
- [3. PayPal developer account (sandbox)](#3-paypal-developer-account-sandbox)
- [4. Configure `.env`](#4-configure-env)
- [5. Run locally](#5-run-locally)
- [6. Webhooks (public URL)](#6-webhooks-public-url)
- [7. Test the Phase 1 money flow](#7-test-the-phase-1-money-flow)
- [8. Deploy to Render](#8-deploy-to-render)
- [9. Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 (see `.nvmrc`) | web, worker, scripts |
| npm | 10+ | workspaces |
| Redis | 7 | BullMQ queue. `docker compose up -d redis`, or any local `redis-server` |
| A Neon account | free tier is fine | Postgres |
| A PayPal developer account | free | sandbox money |

```bash
npm install
cp .env.example .env
```

---

## 2. Neon database

Ahadi uses two Neon connection strings: a **pooled** one for the running app (many short connections through PgBouncer) and a **direct** one for migrations (DDL needs a real session).

1. Sign in at **https://console.neon.tech** and click **New project**.
   - **Project name:** `ahadi`
   - **Postgres version:** 16 or 17
   - **Region:** **AWS Europe Central 1 (Frankfurt)**. It's the closest Neon region to Nairobi and matches the Render region in `render.yaml`. Keep the DB and the app in the same region.
   - **Database name:** `ahadi`
2. Neon creates a `main` branch. That is **production**. For local development, create a second branch:
   **Branches → New branch →** name `dev`, parent `main`. Branches are free, isolated copies, so you can reset `dev` without touching production.
3. Get the connection strings. On the project dashboard click **Connect**, pick the branch (`dev` for local) and the database `ahadi`, then:
   - Turn **Connection pooling ON** and copy the string. Its host contains `-pooler`. This is `DATABASE_URL`.
   - Turn **Connection pooling OFF** and copy the string. This is `DATABASE_URL_UNPOOLED`.

   Both end in `?sslmode=require&channel_binding=require`. Keep that suffix; Ahadi handles both options.
4. Put both in `.env`, then create the tables and the demo data:

```bash
npm run db:migrate
npm run db:seed
```

**Check:** `npm run paypal:check` prints `✓ Connected to ep-…neon.tech` and `✓ 24 tables present`. In the Neon console, **Tables** shows `promises`, `fundings`, `ledger_events` and the rest.

> Neon scales compute to zero when idle. The first query after a pause takes ~0.5–1 s. That's normal, and the pool reconnects on its own.

---

## 3. PayPal developer account (sandbox)

You need **one sandbox app** (its credentials) and **three sandbox accounts** (fake people). No real money moves.

### 3.1 Sign in and switch to Sandbox

1. Go to **https://developer.paypal.com** and log in with your normal PayPal account (or create one).
2. Make sure the toggle at the top of the dashboard says **Sandbox**, not Live.

### 3.2 Create the sandbox accounts

**Testing Tools → Sandbox Accounts → Create account.** Create these three. Pick **United States** for all three: it's the most reliable country for sandbox Payouts, and you can add a Kenyan worker later.

| Account | Type | Purpose | Notes |
|---|---|---|---|
| `ahadi-platform` | **Business** | Ahadi's merchant account. Captures land here and Payouts are sent from here. | Give it a starting balance (e.g. 5,000 USD) so payouts never fail for lack of funds. |
| `ahadi-buyer` | **Personal** | The **client** who funds milestones | PayPal balance 5,000 USD |
| `ahadi-worker` | **Personal** | The **worker** who gets paid | Any balance |

For each account, open **⋯ → View/Edit account** and note the **email** and **system-generated password** (you can change it). You log in to PayPal checkout with the buyer, and you check received payouts with the worker at **https://www.sandbox.paypal.com**.

### 3.3 Create the app (your API credentials)

1. **Apps & Credentials** (Sandbox tab) **→ Create App**.
   - **App name:** `Ahadi Sandbox`
   - **Type:** **Merchant**
   - **Sandbox account:** choose `ahadi-platform` (the Business account from 3.2). This links money to the right merchant.
2. Copy the **Client ID** and the **Secret** (click *Show*).
3. On the same app page, scroll to **Features** and make sure these are ticked, then **Save**:
   - **Accept payments** (Orders API — required for authorize/capture)
   - **Payouts** ← **required**: without it, every payout fails. In sandbox it's normally available immediately. If it isn't, see Troubleshooting.
   - Optional: **Log in with PayPal** (used later to verify workers' PayPal emails).

### 3.4 Webhook

You register the webhook **after** you have a public HTTPS URL (section 6). The script does it for you, so there's nothing to click now.

**Check:** after filling `.env` (next section), `npm run paypal:check` shows:

```text
PayPal
  ✓ OAuth token issued (sandbox, app APP-…)
  ✓ Authorize & capture enabled
  ✓ Payouts enabled
```

---

## 4. Configure `.env`

```env
APP_URL=http://localhost:3000           # becomes your tunnel/Render URL later
SESSION_SECRET=<openssl rand -base64 48>
DEMO_MODE=true

DATABASE_URL=<Neon pooled string, dev branch>
DATABASE_URL_UNPOOLED=<Neon direct string, dev branch>
REDIS_URL=redis://localhost:6379

PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=<Client ID from 3.3>
PAYPAL_CLIENT_SECRET=<Secret from 3.3>
NEXT_PUBLIC_PAYPAL_CLIENT_ID=<same Client ID>
PAYPAL_WEBHOOK_ID=                      # filled in section 6

DEMO_BUYER_PAYPAL_EMAIL=<ahadi-buyer sandbox email>
DEMO_WORKER_PAYPAL_EMAIL=<ahadi-worker sandbox email>
```

After changing the demo emails, run `npm run demo:reset` so the seeded worker gets the sandbox payout email.

Never commit `.env`. It's in `.gitignore`.

---

## 5. Run locally

```bash
docker compose up -d redis      # or: redis-server --daemonize yes
npm run db:migrate
npm run db:seed
npm run dev                     # web on :3000 + worker
```

Open http://localhost:3000 → **Sign in** → **Client** (demo accounts appear when `DEMO_MODE=true`).

**Check:** http://localhost:3000/api/health returns `"database":"ok","queue":"ok","paypal":"ok"`.

---

## 6. Webhooks (public URL)

PayPal only delivers webhooks to public HTTPS URLs. Ahadi treats webhooks as the source of truth (`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, payout item updates, …). Funding still works without webhooks through the API path, but set them up before the demo.

Local:

```bash
npx cloudflared tunnel --url http://localhost:3000
# copy the https://<random>.trycloudflare.com URL into APP_URL in .env, restart npm run dev
npm run paypal:webhook
# prints PAYPAL_WEBHOOK_ID=… → put it in .env, restart
```

On Render, run it once with your Render URL: `npm run paypal:webhook -- https://ahadi-web.onrender.com`.

The script is idempotent: running it again updates the event list rather than creating duplicates.

**Check:** `npm run paypal:check` shows `✓ Webhook WH-… → https://…/api/webhooks/paypal (17 events)`. In the PayPal dashboard: **Apps & Credentials → Ahadi Sandbox → Webhooks**.

> The dashboard's **Webhooks simulator** sends events whose signatures cannot be verified against your webhook id, so Ahadi rejects them with 400. That is expected. Use real sandbox checkouts instead.

---

## 7. Test the Phase 1 money flow

This is the Phase 1 exit test from SPEC §25: *$400 authorized; $300 captured with `final_capture`; payout received by the sandbox worker.*

1. **Client** → *Mama Njeri's Bakery — Landing Page* → **Fund $400.00 with PayPal**.
2. Log in to the PayPal popup with **ahadi-buyer** and approve. The page shows **Funds secured ($400.00)** with the authorization id, honor period and expiry.
   - In the buyer's sandbox account the $400 shows as a **pending authorization**, not a payment.
3. Switch to **Admin** → *Admin* → the funding row → **Manual verdict →**.
4. Mark c1–c3 **pass** and c4 (*Mobile layout works at 375px*) **fail**. The preview shows **75% → capture $300.00**. Add a note, then **Record verdict and settle → Confirm**.
5. Within a few seconds the worker:
   - captures **$300.00** against the authorization with `final_capture: true` (the remaining $100 is released to the buyer)
   - records PayPal's fee and net amount
   - sends a **Payout** of net − 1.5% Ahadi fee to the worker's sandbox email
6. Open the promise: the milestone moves **Releasing → Settled** once the payout item succeeds (webhook or the 15-minute reconcile). The **Evidence ledger** shows every step, and **Verify chain** confirms it.
7. Log in at https://www.sandbox.paypal.com as **ahadi-worker** and you'll see the payout.

To start over: `npm run demo:reset`.

Also worth trying:

- **Zero release:** fail c1 (required). Ahadi **voids** the authorization and the buyer's hold disappears.
- **Cancel:** open the PayPal popup and close it. The milestone returns to *Not funded*.

---

## 8. Deploy to Render

1. Push the repo to GitHub. In Render: **New → Blueprint →** select the repo. Render reads `render.yaml` and creates `ahadi-web`, `ahadi-worker` and `ahadi-kv` (Redis with `noeviction`).
2. Fill the **ahadi-secrets** environment group. Use the Neon **`main`** branch strings for production:
   `APP_URL` (your `https://ahadi-web.onrender.com`), `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `DEMO_BUYER_PAYPAL_EMAIL`, `DEMO_WORKER_PAYPAL_EMAIL`. `SESSION_SECRET` is generated for you.
3. Deploy. `preDeployCommand` runs `npm run db:migrate` before each web deploy. Seed once from your machine against the `main` branch: `DATABASE_URL=<main pooled> npm run db:seed`.
4. Register the webhook: `npm run paypal:webhook -- https://ahadi-web.onrender.com`. Put the id in `PAYPAL_WEBHOOK_ID` in the env group, then redeploy.
5. CI/CD: `autoDeploy` is off. `.github/workflows/deploy.yml` triggers both services' deploy hooks after CI passes on `main`. In Render, copy each service's **Settings → Deploy Hook** URL into the GitHub repository secrets `RENDER_DEPLOY_HOOK_WEB` and `RENDER_DEPLOY_HOOK_WORKER`.

**Check:** `https://ahadi-web.onrender.com/api/health` returns 200 with all checks `ok`.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `paypal:check` → `Payouts NOT enabled` | App → Features → tick **Payouts** → Save. If the box is missing, create a new Merchant app. If it's still missing, contact PayPal developer support. Sandbox Payouts is usually instant. |
| Fund page: *PayPal unavailable* | `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is empty. It's read at **build** time, so rebuild or restart `npm run dev` after setting it. |
| `OAuth failed (401) invalid_client` | Secret copied wrong, or sandbox credentials used with `PAYPAL_ENV=live`. |
| Settlement *Release failed* with `AUTHORIZATION_EXPIRED` | The hold is older than 29 days. Fund again. |
| Payout `FAILED` / `RECEIVER_UNREGISTERED` | The worker's PayPal email isn't a sandbox account. Fix it in **Settings**, then **Admin → Send / re-check payout**. |
| Payout `UNCLAIMED` | The receiver email has no sandbox account yet. Create one with that email, or fix the email. |
| Payout fails with `INSUFFICIENT_FUNDS` | Add balance to the `ahadi-platform` Business sandbox account (Sandbox Accounts → ⋯ → Edit). |
| Webhook returns 400 | Signature verification failed. Either it came from the simulator, or `PAYPAL_WEBHOOK_ID` belongs to a different app or URL. Re-run `npm run paypal:webhook`. |
| `/api/health` → `queue: error` | Redis isn't running or `REDIS_URL` is wrong. |
| Jobs never run | The worker isn't running (`npm run dev` starts it; on Render check `ahadi-worker` logs). |
| `relation "promises" does not exist` | Run `npm run db:migrate` against the same branch as `DATABASE_URL`. |
