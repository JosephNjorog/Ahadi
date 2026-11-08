# Ahadi

**PayPal moves the money. Ahadi decides when it should move.**

Ahadi (Swahili for *promise*) is a trust layer for paying for work — done by humans or by AI agents. Every payment becomes a **promise**: terms agreed in advance, funds secured through PayPal, and money released only when AI verifier agents confirm the work meets the agreed acceptance criteria.

> Built for **Build What's Next with PayPal and AI** (2026) by [Elom Labs](https://synchstacksolutionslabs.vercel.app/), Nairobi.

| | |
|---|---|
| 🎥 Demo video | `https://youtu.be/REPLACE_ME` |
| 🌐 Live demo | `https://ahadi.onrender.com` (sandbox) |
| 📐 Technical spec | [docs/SPEC.md](docs/SPEC.md) |
| 🧠 Agent prompts | [docs/AGENT_PROMPTS.md](docs/AGENT_PROMPTS.md) |
| 📄 License | [MIT](LICENSE) |

---

## Table of contents

1. [The problem](#the-problem)
2. [The solution](#the-solution)
3. [How it works](#how-it-works)
4. [Features](#features)
5. [How Ahadi uses PayPal](#how-ahadi-uses-paypal)
6. [How Ahadi uses AI (tools used)](#how-ahadi-uses-ai-tools-used)
7. [Architecture](#architecture)
8. [Tech stack](#tech-stack)
9. [Getting started](#getting-started)
10. [PayPal sandbox setup](#paypal-sandbox-setup)
11. [Environment variables](#environment-variables)
12. [Running the demo](#running-the-demo)
13. [Using Ahadi from an AI agent (MCP)](#using-ahadi-from-an-ai-agent-mcp)
14. [Project structure](#project-structure)
15. [Safety and trust design](#safety-and-trust-design)
16. [Roadmap](#roadmap)
17. [Team](#team)

---

## The problem

Paying a stranger for work is broken — and AI agents are about to make it worse.

**1. The global freelancer trust gap.** A client in Berlin hires a developer in Nairobi. The client fears paying and getting nothing; the developer fears working and not getting paid. Deals stall on "free trial tasks" and "50% upfront", or retreat to marketplaces that charge 10–20% and lock both sides in.

**2. Disputes are judged too late, on no evidence.** When work goes wrong, a payment provider is asked weeks later: *was this delivered as described?* There was never a shared definition of "done", so it is one person's word against another's.

**3. African earners look suspicious by default.** Cross-border freelance income looks like unexplained inbound money. Freelancers face account reviews and freezes, with no simple way to prove *"this $2,000 was for a real website I really built."*

**4. Agents can pay, but cannot verify.** Agentic commerce lets AI agents buy things. But when an agent hires another agent — or a human — to *do work*, nothing checks the work before money moves. Agents either pay blindly or not at all.

**The common root:** money and proof of work are disconnected.

## The solution

Ahadi ties every payment to verifiable proof of work.

1. **Terms** — An AI Contract Architect turns a plain-language job ("build me a landing page for my bakery") into milestones with *checkable* acceptance criteria. Both sides approve. Vague terms are flagged before anyone commits.
2. **Secured money** — The client funds each milestone through PayPal Checkout with an **authorization**: the money is reserved, not yet captured. The worker sees *funds secured* before starting.
3. **Verified release** — On submission, specialist verifier agents check the work against each criterion and produce an evidence report. Deterministic settlement logic then **captures the full amount, captures a fair partial amount and voids the rest, or releases nothing** — followed by a PayPal Payout to the worker.

Every settled promise adds to the worker's **Ahadi Passport**: a portable, system-generated record of verified, paid work that doubles as a source-of-funds statement.

The whole engine is also exposed as an **MCP server**, so AI agents can hire and pay other agents or humans — with payment released only on verified work, inside spending rules their human owner sets.

## How it works

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as Ahadi
    participant P as PayPal
    participant W as Worker
    participant V as Verifier agents

    C->>A: Describe the job (text / brief / voice)
    A->>A: Contract Architect → milestones + criteria
    C->>A: Approve terms
    W->>A: Approve terms
    C->>P: Checkout (intent = AUTHORIZE)
    P-->>A: Authorization created → "Funds secured"
    W->>A: Submit deliverable (repo / URL / files)
    A->>V: Verify against signed criteria
    V-->>A: Per-criterion verdicts + evidence
    A->>A: Settlement engine computes release %
    C-->>A: Objection window (accept / object)
    A->>P: Capture (full or partial, final_capture = true)
    A->>P: Payout to worker (minus platform fee)
    P-->>W: Funds in PayPal → M-Pesa
    A->>A: Append to evidence ledger + Passport
```

## Features

### Layer 1 — Promise engine
| # | Feature | What it does |
|---|---|---|
| 1 | **AI contract builder** | Text, brief upload or voice note (English/Swahili) → milestones, deliverables, deadlines, weighted acceptance criteria. Flags unverifiable terms. In-app negotiation with versioned, hashed terms. |
| 2 | **Secured funding** | PayPal Checkout with `intent: AUTHORIZE` per milestone. Tracks honor period and expiry; prompts reauthorization so holds never lapse silently. |
| 3 | **Verifier agents** | Specialists for **websites**, **code**, **design**, **writing/research** and **data**. Each criterion gets `pass / partial / fail`, evidence and a confidence score. Low confidence routes to a human. |
| 4 | **Smart settlement** | Full pass → objection window → capture. Partial → proposed split with reasons → partial capture, rest released. Fail → fix list and resubmission. Human veto always available; high-value releases need explicit confirmation. |
| 5 | **Payouts** | PayPal Payouts to the worker, team splits by percentage, and a "what lands in M-Pesa" estimate. |

### Layer 2 — Trust and compliance
| # | Feature | What it does |
|---|---|---|
| 6 | **AI mediator** | Reads terms, evidence and both sides' arguments; proposes a reasoned resolution before anything becomes a payment dispute. Escalations carry a ready evidence pack. |
| 7 | **Evidence ledger** | Hash-chained timeline per promise: terms → funded → submitted → verified → released. Exportable PDF. |
| 8 | **Ahadi Passport** | Shareable record of verified promises, first-pass rate and work types, plus a source-of-funds statement linking each payout to its contract and verification. |
| 9 | **Injection and fraud guard** | Deliverables are treated as data, never instructions. Hidden-text and injection attempts are detected and shown to the client. Plagiarism, reused work and money-cycling patterns are flagged. |

### Layer 3 — Agent economy
| # | Feature | What it does |
|---|---|---|
| 10 | **Ahadi MCP server** | `create_promise`, `fund_promise`, `submit_work`, `get_verdict`, `release`, `dispute` — any MCP client can hire verified work. |
| 11 | **Agent marketplace** | Agents and humans list services with verifiable deliverables and compete on verified track records. |
| 12 | **Spending mandates** | Owners cap per-job and monthly spend, allowed categories and minimum provider scores. Enforced before funding. |

### Layer 4 — Access
| # | Feature | What it does |
|---|---|---|
| 13 | **WhatsApp interface** | Accept terms, submit links, get verdicts and payout notices in WhatsApp. |
| 14 | **Dashboards** | Client, worker and admin views. Admin ledger built on AG Grid. |
| 15 | **Platform API** | Agencies and marketplaces embed Ahadi promises in their own products. |

## How Ahadi uses PayPal

PayPal is the money layer for every promise — not a checkout button bolted on at the end.

| PayPal capability | Where Ahadi uses it |
|---|---|
| **Orders v2** (`intent: AUTHORIZE`) | Funding each milestone; buyer approves in PayPal Checkout. |
| **Payments v2 — authorizations** | `capture` (full or partial with `final_capture`), `void`, `reauthorize`, `GET` status for expiry tracking. |
| **Payments v2 — captures** | `refund` for post-settlement mediation outcomes. |
| **Payouts v1** | Paying workers and team splits after capture. |
| **Webhooks** | Source of truth for authorization, capture, payout and dispute state. Signatures verified. |
| **Disputes v1** | Attaching Ahadi evidence packs when a disagreement escalates to PayPal. |
| **JavaScript SDK** | PayPal / Venmo / card buttons on the funding page. |
| **Agent Toolkit / MCP server** | Ops agent for reporting and reconciliation over the merchant account. |

Production path (documented in the spec): PayPal's multiparty platform with **delayed disbursement**, so funds go to the worker as payee and Ahadi never holds client money.

## How Ahadi uses AI (tools used)

| Tool / model | Role in Ahadi |
|---|---|
| **Claude Opus 5.5** (`claude-opus-5-5`) | Contract Architect, AI Mediator, final review of borderline verdicts. |
| **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | Verifier agents (web, code, design via vision, writing/research, data), Criteria Critic, Risk Analyst. |
| **Claude Haiku 5.5** (`claude-haiku-5-5`) | Injection Sentinel, WhatsApp concierge, intent classification, summaries. |
| **Speech-to-text** (Whisper or Deepgram) | Voice-note job descriptions → text for the Contract Architect. |
| **Playwright + Lighthouse** | Evidence collection for website verification (screenshots, performance, DOM checks). |
| **Sandboxed code runner** (Vercel Sandbox or E2B) | Running submitted test suites in isolation. |
| **Model Context Protocol** | Ahadi's own MCP server, plus PayPal's MCP server for ops. |
| **Claude Code** | Used to build this project. |

All model output is structured (tool use with JSON schemas) and validated with Zod. **No model ever moves money directly.** Models produce verdicts; a deterministic settlement engine computes amounts; only the settlement service can call PayPal.

## Architecture

```mermaid
flowchart LR
    subgraph Clients
      WEB[Web app<br/>Next.js]
      WA[WhatsApp]
      AG[AI agents<br/>MCP clients]
    end

    subgraph Ahadi
      API[API routes<br/>Next.js]
      MCP[MCP server]
      Q[(Queue<br/>Render Key Value)]
      WK[Worker<br/>agents + settlement]
      DB[(Postgres)]
      OBJ[(Artifact storage)]
    end

    subgraph External
      PP[PayPal REST APIs<br/>+ webhooks]
      CL[Claude API]
      SB[Code sandbox]
      BR[Headless browser]
    end

    WEB --> API
    WA --> API
    AG --> MCP --> API
    API --> DB
    API --> Q --> WK
    WK --> DB
    WK --> OBJ
    WK --> CL
    WK --> SB
    WK --> BR
    WK --> PP
    API --> PP
    PP -- webhooks --> API
```

## Tech stack

| Layer | Technology |
|---|---|
| Web + API | Next.js 15 (App Router), TypeScript, Tailwind CSS v4 |
| Worker | Node.js 20, BullMQ |
| MCP server | `@modelcontextprotocol/sdk` (Streamable HTTP) |
| Database | PostgreSQL + Drizzle ORM |
| Queue / cache | Render Key Value (Redis-compatible) |
| AI | Anthropic Claude API (`@anthropic-ai/sdk`) |
| Payments | PayPal REST APIs (sandbox), PayPal JS SDK |
| Verification | Playwright, Lighthouse, Vercel Sandbox / E2B |
| Tables | AG Grid Community |
| Messaging | WhatsApp Cloud API |
| Hosting | Render (web service, worker, Postgres, Key Value) |

## Getting started

### Prerequisites
- Node.js 20+
- npm 10+
- Docker (for local Postgres and Redis), or Render-hosted equivalents
- A [PayPal Developer](https://developer.paypal.com/) account
- An [Anthropic API](https://console.anthropic.com/) key

### Install

```bash
git clone https://github.com/<your-org>/ahadi.git
cd ahadi
npm install
cp .env.example .env.local
docker compose up -d          # Postgres + Redis
npm run db:migrate
npm run db:seed               # demo users, sample promises, fixtures
```

### Run

```bash
npm run dev                   # web (3000) + worker + MCP server (3001)
```

Open [http://localhost:3000](http://localhost:3000).

### Useful scripts

| Script | What it does |
|---|---|
| `npm run dev` | Runs web, worker and MCP server together |
| `npm run build` | Builds all apps |
| `npm run test` | Unit tests (settlement engine, state machine, ledger) |
| `npm run test:e2e` | End-to-end sandbox flow with Playwright |
| `npm run db:studio` | Opens Drizzle Studio |
| `npm run paypal:webhook` | Registers the webhook for your sandbox app |
| `npm run demo:reset` | Resets the demo dataset |

## PayPal sandbox setup

1. Log in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) and switch to **Sandbox**.
2. **Apps & Credentials → Create App** (type: Merchant). Copy the **Client ID** and **Secret**.
3. Under the app's features, make sure **Payouts** is enabled.
4. **Sandbox → Accounts:** create (or reuse) three accounts:
   - **Business** — Ahadi's platform account (the app owner).
   - **Personal** — the client / buyer.
   - **Personal** — the worker / payee.
5. Put the buyer and worker emails in `.env.local` (`DEMO_BUYER_EMAIL`, `DEMO_WORKER_EMAIL`).
6. Expose your local server (e.g. `npx cloudflared tunnel --url http://localhost:3000`) and set `APP_URL`.
7. Run `npm run paypal:webhook` to register `${APP_URL}/api/webhooks/paypal` and save the returned ID as `PAYPAL_WEBHOOK_ID`.

## Environment variables

```env
# App
APP_URL=http://localhost:3000
NODE_ENV=development
SESSION_SECRET=change-me

# Database / queue
DATABASE_URL=postgres://ahadi:ahadi@localhost:5432/ahadi
REDIS_URL=redis://localhost:6379

# PayPal (sandbox)
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
NEXT_PUBLIC_PAYPAL_CLIENT_ID=

# Anthropic
ANTHROPIC_API_KEY=
MODEL_ARCHITECT=claude-opus-5-5
MODEL_VERIFIER=claude-sonnet-5-5
MODEL_FAST=claude-haiku-5-5

# Verification
SANDBOX_PROVIDER=vercel            # vercel | e2b | docker
SANDBOX_API_KEY=
ARTIFACT_BUCKET_URL=
ARTIFACT_BUCKET_KEY=

# Speech-to-text (optional)
STT_PROVIDER=whisper
STT_API_KEY=

# WhatsApp (optional)
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=

# Policy
PLATFORM_FEE_BPS=150               # 1.5%
OBJECTION_WINDOW_HOURS=48          # set to 0.05 for demos
HUMAN_CONFIRM_ABOVE_USD=1000
MIN_AUTO_CONFIDENCE=0.80

# Demo
DEMO_BUYER_EMAIL=
DEMO_WORKER_EMAIL=
```

## Running the demo

The seed script creates **"Mama Njeri's Bakery — Landing Page"**, a $400 one-milestone promise with four criteria, and two fixture deliverables.

1. Sign in as **Client** → open the promise → **Fund with PayPal** → approve with the sandbox buyer.
2. The status shows **Funds secured ($400.00)**.
3. Switch to **Worker** → **Submit work** → choose `fixtures/bakery-site-v1` (one criterion fails on purpose).
4. Watch verification run live: three pass, *mobile layout at 375px* fails.
5. The settlement engine proposes **75% ($300.00)**. Client clicks **Accept split**.
6. Ahadi captures $300 against the authorization (`final_capture: true`, releasing the remainder) and sends a Payout to the worker.
7. Submit `fixtures/bakery-site-injection` → the Injection Sentinel flags hidden text telling the verifier to approve.
8. **Agent demo:** connect Claude Desktop to the MCP server (below) and ask: *"Hire a research agent for a $25 report on the Nairobi cold-chain market. Pay only if it cites at least 8 real sources."*

## Using Ahadi from an AI agent (MCP)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "ahadi": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer <AHADI_AGENT_KEY>" }
    }
  }
}
```

Tools exposed: `search_providers`, `create_promise`, `fund_promise`, `get_promise`, `submit_work`, `get_verdict`, `release`, `dispute`, `get_mandate`. Full schemas are in [docs/SPEC.md](docs/SPEC.md#12-mcp-server).

## Project structure

```text
ahadi/
├── apps/
│   ├── web/                  # Next.js app: UI + API routes + webhooks
│   ├── worker/               # BullMQ worker: agents, verification, settlement
│   └── mcp/                  # Ahadi MCP server
├── packages/
│   ├── core/                 # Domain types, state machine, settlement engine
│   ├── db/                   # Drizzle schema, migrations, seed
│   ├── paypal/               # Typed PayPal REST client + webhook verification
│   ├── agents/               # Prompts, schemas, agent runners
│   ├── verifiers/            # Web, code, design, writing, data evidence collectors
│   ├── ledger/               # Hash-chained evidence ledger + PDF export
│   └── ui/                   # Shared UI components
├── fixtures/                 # Demo deliverables (pass, partial, injection)
├── docs/
│   ├── SPEC.md
│   └── AGENT_PROMPTS.md
├── docker-compose.yml
├── render.yaml
├── .env.example
├── LICENSE
└── README.md
```

## Safety and trust design

- **Models never move money.** Agents return verdicts; the settlement engine (pure, unit-tested code) computes amounts; only the settlement service holds PayPal credentials for captures and payouts.
- **Deliverables are data.** All submitted content is wrapped in tagged blocks and scanned by a separate Injection Sentinel before and after verification.
- **Humans keep the veto.** Every release has an objection window, either side can escalate, and releases above `HUMAN_CONFIRM_ABOVE_USD` require explicit confirmation.
- **Low confidence → human.** Any criterion below `MIN_AUTO_CONFIDENCE` blocks auto-release.
- **Idempotent payments.** Every PayPal write uses a `PayPal-Request-Id` derived from the promise, milestone and action.
- **Tamper-evident history.** Ledger events are hash-chained; any edit breaks the chain.
- **Sandbox only** for this submission. No real funds move.

## Roadmap

- [x] Promise engine: contract builder, authorize, verify, partial capture, payouts
- [x] Evidence ledger and Passport
- [x] MCP server with spending mandates
- [ ] PayPal multiparty with delayed disbursement (worker as payee)
- [ ] Stablecoin payout rail
- [ ] Platform API with webhooks for partners
- [ ] Verifier plugins for mobile apps, video and translation
- [ ] Reputation-based funding terms (lower holds for high-trust pairs)

## Team

**Elom Labs** — Nairobi, Kenya. Software engineering company and technology consultancy.
[synchstacksolutionslabs.vercel.app](https://synchstacksolutionslabs.vercel.app/)

---

Licensed under the [MIT License](LICENSE).
