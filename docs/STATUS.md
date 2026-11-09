# Ahadi — Build status

What is built, what was verified, and what remains. Last updated with the Phase 1–6 build.

## Done

| Phase (SPEC §25) | Built | Verified by |
|---|---|---|
| **1 — Money spine** | Monorepo (npm workspaces + Turborepo), full schema on Neon (Drizzle, 2 migrations), typed PayPal client (Orders authorize, capture/partial `final_capture`, void, reauthorize, refund, Payouts, webhooks with signature verification, disputes), funding page with PayPal JS SDK (popup + redirect), webhook ingestion, authorization honor/expiry monitor, payouts with splits + reconciliation, hash-chained ledger, admin manual verdict | Unit tests (settlement engine property tests, state machines, ledger tamper tests, PayPal client); integration test of the full $400 → 75% → $300 capture → payout → SETTLED flow on Postgres + Redis with a stateful fake PayPal |
| **2 — Promise engine** | Create promise (text or voice brief), Contract Architect + Criteria Critic, terms editor (Apply suggestion, Architect revisions, hand edits, versions), invites, hash-checked signing, milestones created on agreement | Integration test: hand-written terms → invite → both sign the same hash → funding |
| **3 — Verification** | Web collector (Playwright: desktop/mobile screenshots, DOM, scroll checks, links, LCP, real form submits, rendered hidden text), deterministic injection scanner + Injection Sentinel, strip-and-compare, all 14 machine checks, verifier agents with borderline re-runs + Verdict Reviewer, human review, proposals with Explainer, objection window, decisions, auto-accept, live SSE verification screen | Real-Chromium tests on the fixtures: v1 fails at 375px, v2 passes, injection flagged high; end-to-end flow test through human review → 75% → both accept → capture |
| **4 — Trust layer** | Code (GitHub static analysis + E2B/Docker sandbox), writing/research (citations, reachability, claim sampling), design (sharp: dimensions, palette, previews), data (CSV/JSON profile, JSON Schema) collectors; Mediator (+ admin resolution); Risk Analyst + hard self-dealing rules with payout holds; evidence-pack PDF; Passport + provider score; Ed25519-signed source-of-funds statements | Unit tests for collectors, signing, passport score, weight rebalancing |
| **5 — Agent economy** | MCP server at `/mcp` (9 tools), agent API keys, spending mandates, marketplace, HMAC-signed provider webhooks, Kazi Research Agent (web search), agent auto-signing | Live HTTP test: tools/list, get_mandate, search_providers, structured `MANDATE_EXCEEDED`, 401 without key |
| **6 — Reach and polish** | WhatsApp concierge (inbound + replies), voice briefs (Whisper/Deepgram), notifications (in-app, email, WhatsApp), AG Grid admin ledger, Ops Agent (read-only tools), review queue, risk flags, agent-run log, daily ledger anchors | Typecheck, lint and production build |
| **Infra** | CI (lint, format, typecheck, unit, integration with Postgres + Redis, build, migration drift), Render web service `ahadi-web` (free, Frankfurt, deploys from `main` after CI), worker-in-web mode | CI workflow; Render service created via API |

## Not yet verified (needs your credentials)

These are fully implemented but have only run against fakes or with the feature switched off:

1. **Real PayPal sandbox** — order, authorization, partial capture, void, payouts and webhooks against your sandbox app (`npm run paypal:check`, then SETUP.md §7).
2. **AI agents in production** — agents run through OpenRouter (free models by default) or the Anthropic API. Live runs on the free models are covered in the section below; Kazi's web research uses OpenRouter's paid web plugin and needs credits.
3. **Neon** — tested on local Postgres 16; the Neon-specific connection handling (pooled/direct, SSL, channel binding) runs on first deploy.
4. **Render deploy** — the service exists but has not built the full app yet (deploys after `main` gets the code and CI passes; env vars must be set first).
5. **Optional integrations** — E2B sandbox, Resend email, Whisper/Deepgram, WhatsApp Cloud API.

## Remaining work

| Item | Notes |
|---|---|
| Run the live sandbox demo end to end | SETUP.md §7 and the MCP demo in docs/MCP.md; fix whatever real APIs reveal. |
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
| Demo video and live URL in README | After the first successful deploy. |

## Deviations from the spec (deliberate)

- Domain services live in `packages/services` (not `packages/core/services`) to avoid a circular import with `packages/db`.
- Sign-in is a custom magic link + signed session cookie (plus demo accounts) instead of Auth.js.
- `fundings` keeps one row per checkout attempt; "one live funding per milestone" is enforced in code.
- Artifacts are stored in Postgres (bytea, content-addressed) instead of a bucket.
- PDFs use pdfkit instead of `@react-pdf/renderer`.
- Prompts are versioned TypeScript modules instead of `.md` files (bundling).
- Agents use structured JSON output validated with Zod plus code-level checks, through either OpenRouter (OpenAI-compatible, `response_format: json_schema`) or the Anthropic API (`output_config.format`).
- MCP is served by the web app at `/mcp` (one service on the free plan); a standalone server is also available on port 3001.
