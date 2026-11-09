# Ahadi — Build status

What is built, what was verified, and what remains. Last updated 9 November 2026, after the live sandbox runs, the landing page redesign and the new brand.

## Done

| Phase (SPEC §25) | Built | Verified by |
|---|---|---|
| **1 — Money spine** | Monorepo (npm workspaces + Turborepo), full schema on Neon (Drizzle, 2 migrations), typed PayPal client (Orders authorize, capture/partial `final_capture`, void, reauthorize, refund, Payouts, webhooks with signature verification, disputes), funding page with PayPal JS SDK (popup + redirect), webhook ingestion, authorization honor/expiry monitor, payouts with splits + reconciliation, hash-chained ledger, admin manual verdict | Unit tests (settlement engine property tests, state machines, ledger tamper tests, PayPal client); integration test of the full $400 → 75% → $300 capture → payout → SETTLED flow on Postgres + Redis with a stateful fake PayPal |
| **2 — Promise engine** | Create promise (text or voice brief), Contract Architect + Criteria Critic, terms editor (Apply suggestion, Architect revisions, hand edits, versions), invites, hash-checked signing, milestones created on agreement | Integration test: hand-written terms → invite → both sign the same hash → funding |
| **3 — Verification** | Web collector (Playwright: desktop/mobile screenshots, DOM, scroll checks, links, LCP, real form submits, rendered hidden text), deterministic injection scanner + Injection Sentinel, strip-and-compare, all 14 machine checks, verifier agents with borderline re-runs + Verdict Reviewer, human review, proposals with Explainer, objection window, decisions, auto-accept, live SSE verification screen | Real-Chromium tests on the fixtures: v1 fails at 375px, v2 passes, injection flagged high; end-to-end flow test through human review → 75% → both accept → capture |
| **4 — Trust layer** | Code (GitHub static analysis + E2B/Docker sandbox), writing/research (citations, reachability, claim sampling), design (sharp: dimensions, palette, previews), data (CSV/JSON profile, JSON Schema) collectors; Mediator (+ admin resolution); Risk Analyst + hard self-dealing rules with payout holds; evidence-pack PDF; Passport + provider score; Ed25519-signed source-of-funds statements | Unit tests for collectors, signing, passport score, weight rebalancing |
| **5 — Agent economy** | MCP server at `/mcp` (9 tools), agent API keys, spending mandates, marketplace, HMAC-signed provider webhooks, Kazi Research Agent (web search), agent auto-signing | Live HTTP test: tools/list, get_mandate, search_providers, structured `MANDATE_EXCEEDED`, 401 without key |
| **6 — Reach and polish** | WhatsApp concierge (inbound + replies), voice briefs (Whisper/Deepgram), notifications (in-app, email, WhatsApp), AG Grid admin ledger, Ops Agent (read-only tools), review queue, risk flags, agent-run log, daily ledger anchors | Typecheck, lint and production build |
| **Infra** | CI (lint, format, typecheck, unit, integration with Postgres + Redis, build, migration drift), Render web service `ahadi-web` (free, Frankfurt, deploys from `main` after CI, migrations on build), Neon Postgres, Upstash Redis, worker-in-web mode | Live at https://ahadi-web.onrender.com; `/api/health` reports database, queue, PayPal and webhook OK |
| **Brand and landing** | Ahadi mark (open ring + settling dot) with logo, app icon, animated SVG and favicon; Open Graph image; landing page redesign (monochrome, light/dark, product preview from a real settlement, problem, how it works, verification, settlement math, agents, guarantees, about us, infrastructure, demo guide); README rewritten for reviewers | Production build; screenshots at 1440px (light and dark) and 375px with no sideways scroll |

## Verified live (PayPal sandbox, production deploy)

| What | Result |
|---|---|
| **Run 1: manual verdict, $400 → 75%** | Order `6VC40814PN698800V` COMPLETED · authorization `2GY97725S3048145L` CAPTURED · capture `9LF72135AN2545515` $300.00 with `final_capture` (fee $10.96, net $289.04) · payout batch `TBAD9S6FX2UJ6` SUCCESS $284.54 · ledger chain valid (18 events) |
| **Run 2: AI verification, $40 → 80%** | Order `28M66813HM453064Y` COMPLETED · authorization `7X456514AC2002036` CAPTURED · capture `71P51220SA722625D` $32.00 with `final_capture` (fee $1.61, net $30.39) · payout batch `Z3GTHABUQJS56` / item `UTZDU8UBU6LF2` SUCCESS $29.91 |
| **Agents on free OpenRouter models** | Architect, Critic, Sentinel, Verifier (with images), Explainer and Risk Analyst ran in production. Run 2: c1 pass (machine), c2 pass 0.85 and c3 pass 0.90 (verifier), c4/c5 to human review (no browser on the free host), Explainer output correct for both parties |
| **Webhooks** | Payout item and batch events received, signature-verified and reconciled |
| **Self-test payout** | $1 payout `3Z7LWMK96ZH6G` SUCCESS |
| **Neon + Upstash** | Pooled/direct connections, SSL and channel binding work on Render; BullMQ jobs and schedulers run in the web process |

### Findings from the live runs

| Finding | Status |
|---|---|
| The Risk Analyst held a payout on a single low-severity `NEW_ACCOUNTS` signal | **Fixed:** an AI hold now needs a rule hit of medium or high severity (hard self-dealing rules still always hold) |
| The free-model Injection Sentinel flagged a harmless HTML comment ("Built for Mama Njeri's Bakery…") as an injection | Open. The flag only blocks auto-release, and the admin cleared it with a note. Options: require deterministic pattern hits or a quote containing AI-directed language before an `injection` verdict counts, or use a stronger model for the Sentinel |
| No Chromium on Render's free native runtime | Open (see below): browser criteria go to the review queue on the hosted demo |

## Remaining work

| Item | Notes |
|---|---|
| Sentinel false positives on free models | See findings above. |
| MCP demo against production | Create an agent key on the live app and run the research-agent prompt from docs/MCP.md (Kazi's web search needs OpenRouter credits). |
| Agent evaluation suite (`npm run eval:agents`, AGENT_PROMPTS §13) | Golden tests on the fixtures with a real key: Sentinel flags the injection fixture, verifier never passes it, Critic flags "modern design", Mediator handles out-of-scope, Explainer adds no amounts. |
| Playwright E2E test of the UI against the sandbox | SPEC §22 "E2E" row. |
| Chromium on Render | Free native Node runtime has no system Chromium: website screenshots fall back to fetch-only evidence (visual criteria go to a human). Fix: Docker deploy with Chromium, or a paid instance with `npx playwright-core install --with-deps chromium-headless-shell`. |
| Lighthouse machine check | Returns "undetermined → human" today; add Lighthouse in the Chromium-enabled worker. |
| Separate worker + Render Key Value | Needed off the free plan (free web sleeps, pausing scheduled jobs). `render.yaml` documents the switch. |
| PayPal dispute evidence upload | `provideDisputeEvidence` exists; wire it to the evidence-pack PDF on `CUSTOMER.DISPUTE.CREATED` (sandbox dispute simulation is limited). |
| Escalated milestones | ESCALATED is terminal and keeps the hold until expiry; add an admin "settle/void escalated" action. |
| PayPal multiparty with delayed disbursement | Production path (SPEC §6.10), needs PayPal partner approval. |
| Pre-approved agent funding (PayPal Vault) | Stretch (SPEC §12.3); agents use owner approval URLs today. |
| WhatsApp message templates | Create and get Meta approval for `job_offer`, `funds_secured`, `verdict_ready`, `payment_sent`, `hold_expiring`. |
| Demo video | Live URL is in the README; record the walkthrough from the README's "Test it yourself" section. |
| Brand rollout inside the app | The new mark is in the header, sign-in, favicon and share image; the signed-in app still uses the green palette. Bring the monochrome landing style into the dashboard if wanted. |
| Rotate secrets | The PayPal secret, Neon password, Upstash token and OpenRouter key were shared during setup; rotate them and update Render. |

## Deviations from the spec (deliberate)

- Domain services live in `packages/services` (not `packages/core/services`) to avoid a circular import with `packages/db`.
- Sign-in is a custom magic link + signed session cookie (plus demo accounts) instead of Auth.js.
- `fundings` keeps one row per checkout attempt; "one live funding per milestone" is enforced in code.
- Artifacts are stored in Postgres (bytea, content-addressed) instead of a bucket.
- PDFs use pdfkit instead of `@react-pdf/renderer`.
- Prompts are versioned TypeScript modules instead of `.md` files (bundling).
- Agents use structured JSON output validated with Zod plus code-level checks, through either OpenRouter (OpenAI-compatible, `response_format: json_schema`) or the Anthropic API (`output_config.format`).
- MCP is served by the web app at `/mcp` (one service on the free plan); a standalone server is also available on port 3001.
