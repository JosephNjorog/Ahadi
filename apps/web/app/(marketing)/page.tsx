import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconArrow,
  IconBot,
  IconChain,
  IconChat,
  IconCheck,
  IconClock,
  IconDoc,
  IconLock,
  IconRepeat,
  IconScan,
  IconShield,
  IconSplit,
  IconUser,
  IconX,
} from "@/components/ui/icons";
import { AhadiMark } from "@/components/brand/ahadi-mark";
import { ProductMock } from "@/components/landing/product-mock";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Ahadi — pay for work only when it's done" },
};

/* ------------------------------------------------------------------ pieces */

function Btn({
  href,
  children,
  kind = "solid",
  size = "md",
}: {
  href: string;
  children: ReactNode;
  kind?: "solid" | "outline" | "ghost";
  size?: "sm" | "md";
}) {
  const k =
    kind === "solid"
      ? "bg-l-fg text-l-bg hover:opacity-90"
      : kind === "outline"
        ? "border border-l-line2 bg-l-card text-l-fg hover:bg-l-bg2"
        : "text-l-muted hover:text-l-fg";
  const s = size === "sm" ? "h-8 px-3 text-[13px]" : "h-11 px-5 text-[14.5px]";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition ${k} ${s}`}
    >
      {children}
    </Link>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-[family-name:var(--font-geist-mono)] text-[12px] uppercase tracking-[0.12em] text-l-subtle">
      {children}
    </p>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: ReactNode; body?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-3xl font-semibold leading-[1.1] tracking-[-0.035em] text-balance sm:text-[42px]">
        {title}
      </h2>
      {body ? <p className="mt-4 text-[16px] leading-relaxed text-l-muted text-pretty">{body}</p> : null}
    </div>
  );
}

function Code({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-l-line bg-l-card">
      <div className="flex items-center justify-between border-b border-l-line px-4 py-2.5">
        <span className="font-[family-name:var(--font-geist-mono)] text-[12px] text-l-muted">{title}</span>
        <span className="flex gap-1.5">
          <span className="size-2 rounded-full bg-l-line2" />
          <span className="size-2 rounded-full bg-l-line2" />
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-[family-name:var(--font-geist-mono)] text-[12.5px] leading-[1.75]">
        {children}
      </pre>
    </div>
  );
}

const c = {
  k: "text-l-fg font-medium",
  m: "text-l-subtle",
  s: "text-l-ok",
  n: "text-l-warn",
};

/* -------------------------------------------------------------------- data */

const PROBLEMS = [
  {
    who: "The client",
    line: "Pays upfront and hopes.",
    body: "Once the money is sent, the only way back is a chargeback or a dispute: weeks of back-and-forth about what was promised.",
  },
  {
    who: "The worker",
    line: "Delivers first and hopes.",
    body: "Freelancers across Africa and beyond finish the job, then chase invoices. A client who goes quiet costs them the whole fee.",
  },
  {
    who: "The AI agent",
    line: "Can't be trusted with a wallet.",
    body: "Agents now buy work from people and from other agents. Nobody wants a model deciding, on its own, when money leaves an account.",
  },
];

const STEPS = [
  {
    n: "01",
    icon: IconDoc,
    title: "Agree on what done means",
    body: "Write the job in plain words, or send a voice note. Ahadi drafts milestones with checkable criteria, weights and evidence. Both sides sign the same hashed terms.",
    foot: "sha256 6c33…a256 · signed ×2",
  },
  {
    n: "02",
    icon: IconLock,
    title: "Secure the money with PayPal",
    body: "The client approves a PayPal authorization for the milestone. The money is held on their account, not taken. The worker sees “Funds secured” before starting.",
    foot: "intent AUTHORIZE · honored 3 days",
  },
  {
    n: "03",
    icon: IconScan,
    title: "Verify against the evidence",
    body: "The worker submits a link, repo, file or text. Machine checks and verifier agents decide each criterion with evidence. Anything uncertain goes to a person.",
    foot: "14 machine checks · injection scan",
  },
  {
    n: "04",
    icon: IconSplit,
    title: "Capture exactly what was earned",
    body: "A fixed rule turns results into an amount. PayPal captures that part, returns the rest to the client, and pays the worker through Payouts.",
    foot: "final_capture · Payouts v1",
  },
];

const GUARANTEES = [
  {
    icon: IconShield,
    title: "Models never move money",
    body: "Agents return verdicts. A pure settlement function computes amounts in integer cents, and only the settlement service can call PayPal.",
  },
  {
    icon: IconUser,
    title: "People keep the veto",
    body: "Both sides see the proposal and can object during a fixed window. Above a threshold, a human has to confirm before anything is captured.",
  },
  {
    icon: IconScan,
    title: "Hidden instructions are caught",
    body: "Every submission is scanned for text aimed at the verifier. Flagged content is stripped and re-checked, and release waits for a reviewer.",
  },
  {
    icon: IconRepeat,
    title: "Retries never pay twice",
    body: "Every PayPal call carries a deterministic idempotency key. Webhooks are signature-checked and processed once.",
  },
  {
    icon: IconChain,
    title: "A ledger anyone can check",
    body: "Each step is an event in a sha256 hash chain, anchored daily. Statements are signed with Ed25519 and verifiable with the public key.",
  },
  {
    icon: IconClock,
    title: "Holds don't quietly expire",
    body: "A monitor tracks every authorization's honor period and reauthorizes or warns before PayPal's 29-day limit.",
  },
];

const CHANNELS = [
  {
    icon: IconUser,
    title: "Web app",
    body: "Clients, workers and reviewers. Terms editor, PayPal checkout, live verification and the ledger.",
  },
  {
    icon: IconBot,
    title: "MCP server",
    body: "Nine tools for AI agents, with API keys and spending mandates set by a human owner.",
  },
  {
    icon: IconChat,
    title: "WhatsApp",
    body: "Briefs, funding links and verdicts in the chat app people already use, with voice notes transcribed.",
  },
];

const STACK = [
  {
    name: "PayPal",
    role: "The money layer",
    points: [
      "Orders v2 with intent AUTHORIZE: funds are held, not taken",
      "Partial capture with final_capture releases the rest in one call",
      "Void and reauthorize keep holds honest; Payouts v1 pays workers",
      "Signature-verified webhooks are the source of truth",
    ],
  },
  {
    name: "Render",
    role: "Where it runs",
    points: [
      "One web service runs the app, API, MCP server and job worker",
      "Deploys from main only after CI passes",
      "Database migrations run on every build",
    ],
  },
  {
    name: "Neon",
    role: "Postgres",
    points: [
      "Promises, terms, results, the hash-chained ledger and evidence files",
      "Pooled connections at runtime, a direct one for migrations",
    ],
  },
  {
    name: "Upstash Redis",
    role: "Job queue",
    points: [
      "BullMQ queues for verification, settlement and payouts",
      "Scheduled monitors for holds, payouts and objection windows",
    ],
  },
  {
    name: "OpenRouter",
    role: "Model gateway",
    points: [
      "Runs the contract, verifier, sentinel and explainer agents",
      "Structured JSON output validated with Zod; Anthropic is one setting away",
    ],
  },
  {
    name: "Playwright",
    role: "Evidence",
    points: [
      "Desktop and phone screenshots, rendered DOM and hidden text",
      "Real form submissions and sideways-scroll checks",
    ],
  },
];

/* -------------------------------------------------------------------- page */

export default async function Landing() {
  const user = await currentUser();
  const start = user ? "/dashboard" : "/sign-in";

  return (
    <div className="lp min-h-dvh antialiased">
      {/* nav */}
      <header className="sticky top-0 z-30 border-b border-l-line bg-l-bg/80 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6" aria-label="Main">
          <Link href="/" className="flex items-center gap-2" aria-label="Ahadi home">
            <AhadiMark animated className="size-[22px]" />
            <span className="text-[17px] font-semibold tracking-[-0.045em]">ahadi</span>
          </Link>
          <ul className="hidden items-center gap-1 text-[13.5px] text-l-muted md:flex">
            {[
              ["#problem", "Why"],
              ["#how", "How it works"],
              ["#verification", "Verification"],
              ["#agents", "Agents"],
              ["#about", "About"],
              ["#try", "Try it"],
            ].map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  className="rounded-md px-2.5 py-1.5 transition-colors hover:bg-l-bg2 hover:text-l-fg"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {user ? null : (
              <span className="hidden sm:inline-flex">
                <Btn href="/sign-in" kind="ghost" size="sm">
                  Sign in
                </Btn>
              </span>
            )}
            <Btn href={start} size="sm">
              {user ? "Dashboard" : "Start a promise"}
            </Btn>
          </div>
        </nav>
      </header>

      <main>
        {/* hero */}
        <section className="relative overflow-hidden">
          <div className="l-grid pointer-events-none absolute inset-0 -z-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-l-line bg-l-card py-1 pl-1 pr-3 text-[12.5px] text-l-muted transition-colors hover:text-l-fg"
            >
              <span className="rounded-full bg-l-fg px-2 py-0.5 text-[11px] font-medium text-l-bg">
                PayPal
              </span>
              Authorize now, capture only what was earned
              <IconArrow className="size-3.5" />
            </a>
            <h1 className="mx-auto mt-6 max-w-4xl text-[44px] font-semibold leading-[1.02] tracking-[-0.05em] text-balance sm:text-7xl">
              Pay for work only when it&apos;s done.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-l-muted text-pretty sm:text-lg">
              Ahadi holds the payment with PayPal, checks the delivered work against terms both sides signed,
              and releases exactly the share that was earned. It works for people and for AI agents.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Btn href={start}>
                {user ? "Open dashboard" : "Start a promise"} <IconArrow className="size-4" />
              </Btn>
              <Btn href="#try" kind="outline">
                Try the sandbox demo
              </Btn>
            </div>
            <p className="mt-4 text-[12.5px] text-l-subtle">PayPal sandbox only. No real money moves.</p>
          </div>

          <div className="relative mx-auto mt-14 max-w-6xl px-4 sm:px-6">
            <ProductMock />
          </div>
        </section>

        {/* numbers strip */}
        <section className="mt-16 border-y border-l-line">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid grid-cols-2 gap-px bg-l-line lg:grid-cols-4">
              {[
                ["$40.00", "authorized by the client"],
                ["4 of 5", "criteria verified"],
                ["$32.00", "captured, $8.00 returned"],
                ["$29.91", "paid to the worker"],
              ].map(([v, l]) => (
                <div key={l} className="bg-l-bg px-4 py-7 first:pl-0 lg:px-6">
                  <p className="tabular text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{v}</p>
                  <p className="mt-1 text-[13px] text-l-muted">{l}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mx-auto max-w-6xl px-4 pb-6 text-[12px] text-l-subtle sm:px-6">
            One real sandbox run, end to end: order, authorization, partial capture and payout, all checked
            against PayPal&apos;s API.
          </p>
        </section>

        {/* problem */}
        <section id="problem" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionHead
            eyebrow="The problem"
            title="Paying for work is a trust problem dressed up as a payments problem."
            body="Moving money is solved. Deciding when it should move is not. Today someone always goes first and carries the risk."
          />
          <div className="mt-12 grid overflow-hidden rounded-xl border border-l-line md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <div
                key={p.who}
                className={
                  "bg-l-card p-6 " + (i > 0 ? "border-t border-l-line md:border-l md:border-t-0" : "")
                }
              >
                <p className="text-[13px] text-l-subtle">{p.who}</p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.02em]">{p.line}</p>
                <p className="mt-3 text-[14px] leading-relaxed text-l-muted">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-l-muted">
            <span className="font-medium text-l-fg">Ahadi</span> (Swahili for “promise”) removes the need to
            go first. The money is secured before work starts, and it moves only when the work matches what
            was agreed, in proportion to how much of it was delivered.
          </p>
        </section>

        {/* how it works */}
        <section id="how" className="scroll-mt-20 border-t border-l-line bg-l-bg2/60">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead
              eyebrow="How it works"
              title="Four steps from a sentence to a settled payment."
              body="Every promise follows the same path. Each step is recorded on the ledger, and either side can see exactly where things stand."
            />
            <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-l-line bg-l-line sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ n, icon: I, title, body, foot }) => (
                <li key={n} className="flex flex-col bg-l-card p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-lg border border-l-line">
                      <I className="size-[18px]" />
                    </span>
                    <span className="font-[family-name:var(--font-geist-mono)] text-[12px] text-l-subtle">
                      {n}
                    </span>
                  </div>
                  <h3 className="mt-6 text-[16px] font-semibold tracking-[-0.015em]">{title}</h3>
                  <p className="mt-2 flex-1 text-[14px] leading-relaxed text-l-muted">{body}</p>
                  <p className="mt-6 border-t border-dashed border-l-line pt-3 font-[family-name:var(--font-geist-mono)] text-[11.5px] text-l-subtle">
                    {foot}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* verification */}
        <section id="verification" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.15fr] [&>*]:min-w-0">
            <div>
              <SectionHead
                eyebrow="Verification"
                title="Evidence first. Verdicts second. Money last."
                body="Each criterion is checked by the cheapest thing that can decide it reliably: a machine check, a verifier agent, or a person."
              />
              <ul className="mt-8 space-y-5 text-[14.5px]">
                {[
                  [
                    "Collectors gather evidence",
                    "Desktop and mobile screenshots, the rendered DOM, real form submissions, repo analysis and sandboxed tests, citations, image palettes, dataset profiles.",
                  ],
                  [
                    "Machine checks decide what they can",
                    "HTTP status, sideways scroll at a phone width, link health, page speed, test results, word counts, schema validity.",
                  ],
                  [
                    "Verifier agents judge the rest",
                    "Every verdict cites the evidence it used. Borderline calls are re-run, and a reviewer agent checks the set for consistency.",
                  ],
                  [
                    "Uncertainty goes to a person",
                    "Low confidence, missing evidence or an injection flag sends the criterion to a reviewer. Nothing is guessed.",
                  ],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-l-fg text-l-bg">
                      <IconCheck className="size-3" />
                    </span>
                    <span>
                      <span className="font-medium">{t}.</span> <span className="text-l-muted">{b}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0 space-y-4">
              <Code title="verification · submission d32d9e3f">
                <span className={c.m}># collect</span>
                {"\n"}GET /fixtures/bakery-site-v1/ <span className={c.s}>200</span> html 6.1 KB
                {"\n"}POST /fixtures/contact <span className={c.s}>200</span> form#contact
                {"\n"}scan hidden text <span className={c.n}>3 findings</span> → sentinel
                {"\n\n"}
                <span className={c.m}># decide</span>
                {"\n"}c1 http_ok <span className={c.s}>pass</span> machine 1.00
                {"\n"}c2 hero names bakery <span className={c.s}>pass</span> verifier 0.85
                {"\n"}c3 cakes + KES prices <span className={c.s}>pass</span> verifier 0.90
                {"\n"}c4 form submits <span className={c.s}>pass</span> reviewer 1.00
                {"\n"}c5 no scroll @375px <span className="text-l-bad">fail</span> reviewer 1.00
                {"\n\n"}
                <span className={c.k}>release 80%</span>{" "}
                <span className={c.m}>→ objection window → both accepted</span>
              </Code>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-l-line bg-l-card p-4">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="flex size-6 items-center justify-center rounded-md bg-l-ok-bg text-l-ok">
                      <IconCheck className="size-3.5" />
                    </span>
                    Explained to the client
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-l-muted">
                    “You are paying $32.00. Four criteria passed. The page scrolls sideways on phones, so
                    $8.00 is returned to you.”
                  </p>
                </div>
                <div className="rounded-xl border border-l-line bg-l-card p-4">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="flex size-6 items-center justify-center rounded-md bg-l-bad-bg text-l-bad">
                      <IconX className="size-3.5" />
                    </span>
                    Explained to the worker
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-l-muted">
                    “Make the specials strip responsive so a 375px screen doesn&apos;t scroll sideways, then
                    resubmit.”
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* settlement */}
        <section className="border-y border-l-line bg-l-bg2/60">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2 [&>*]:min-w-0">
            <SectionHead
              eyebrow="Settlement"
              title="The amount is arithmetic, not an opinion."
              body="Weights are fixed when the terms are signed. Results map to credit, credit maps to cents, and the remainder of the authorization is released back to the client in the same PayPal call."
            />
            <Code title="settlement.ts · deterministic">
              <span className={c.k}>release </span>
              {" = Σ weight × credit   "}
              <span className={c.m}>{"// 15+20+25+20 = 80%"}</span>
              {"\n"}
              <span className={c.k}>capture </span>
              {" = floor(4000 × 0.80)  "}
              <span className={c.m}>{"// 3200¢, final_capture"}</span>
              {"\n"}
              <span className={c.k}>returned </span>
              {" = 4000 − 3200         "}
              <span className={c.m}>{"// 800¢ back to the client"}</span>
              {"\n"}
              <span className={c.k}>paypalFee</span>
              {" = 161                 "}
              <span className={c.m}>{"// read from the capture"}</span>
              {"\n"}
              <span className={c.k}>platform </span>
              {" = floor(3200 × 1.5%)  "}
              <span className={c.m}>{"// 48¢"}</span>
              {"\n"}
              <span className={c.k}>payout </span>
              {" = 3200 − 161 − 48     "}
              <span className={c.s}>{"// 2991¢ = $29.91"}</span>
            </Code>
          </div>
        </section>

        {/* agents */}
        <section id="agents" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
            <div className="order-2 lg:order-1">
              <Code title="POST /mcp · tools/call">
                {"{\n"}
                {"  "}
                <span className={c.m}>&quot;name&quot;</span>:{" "}
                <span className={c.s}>&quot;create_promise&quot;</span>,{"\n"}
                {"  "}
                <span className={c.m}>&quot;arguments&quot;</span>: {"{\n"}
                {"    "}
                <span className={c.m}>&quot;title&quot;</span>:{" "}
                <span className={c.s}>&quot;Competitor pricing report&quot;</span>,{"\n"}
                {"    "}
                <span className={c.m}>&quot;category&quot;</span>:{" "}
                <span className={c.s}>&quot;research&quot;</span>,{"\n"}
                {"    "}
                <span className={c.m}>&quot;budgetUsd&quot;</span>: <span className={c.n}>25</span>,{"\n"}
                {"    "}
                <span className={c.m}>&quot;providerId&quot;</span>:{" "}
                <span className={c.s}>&quot;kazi-research&quot;</span>
                {"\n"}
                {"  }\n}"}
                {"\n\n"}
                <span className={c.m}>{"// over the mandate limit?"}</span>
                {"\n"}
                {"{ "}
                <span className={c.m}>&quot;error&quot;</span>:{" "}
                <span className="text-l-bad">&quot;MANDATE_EXCEEDED&quot;</span>
                {", "}
                <span className={c.m}>&quot;approvalUrl&quot;</span>:{" "}
                <span className={c.s}>&quot;…&quot;</span>
                {" }"}
              </Code>
            </div>
            <div className="order-1 lg:order-2">
              <SectionHead
                eyebrow="Built for agents"
                title="Let agents hire, without handing them the wallet."
                body="An agent can find a provider, create a promise, fund it within its mandate, submit work and read the verdict, all over MCP. The owner sets per-promise and monthly limits, allowed categories and a minimum provider score."
              />
              <div className="mt-8 grid gap-3">
                {CHANNELS.map(({ icon: I, title, body }) => (
                  <div key={title} className="flex gap-3 rounded-xl border border-l-line bg-l-card p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-l-line">
                      <I className="size-[18px]" />
                    </span>
                    <span>
                      <span className="block text-[14px] font-medium">{title}</span>
                      <span className="mt-0.5 block text-[13.5px] leading-relaxed text-l-muted">{body}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* guarantees */}
        <section className="border-t border-l-line">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHead
              eyebrow="Guarantees"
              title="Designed so the worst case is still safe."
              body="The rules below are enforced in code and covered by tests, including property tests on the settlement engine and tamper tests on the ledger."
            />
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-l-line bg-l-line sm:grid-cols-2 lg:grid-cols-3">
              {GUARANTEES.map(({ icon: I, title, body }) => (
                <div key={title} className="bg-l-card p-6">
                  <I className="size-5" />
                  <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-l-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* about */}
        <section id="about" className="scroll-mt-20 border-t border-l-line">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] [&>*]:min-w-0">
              <div>
                <SectionHead
                  eyebrow="About us"
                  title="Built in Nairobi, for people who get paid for their work."
                  body="Ahadi is made by Elom Labs, a software engineering company and technology consultancy in Nairobi. We see the same story every week: good work, done remotely, followed by weeks of chasing payment, or a client who paid upfront and got nothing. We built Ahadi so that neither side has to take that risk."
                />
                <div className="mt-8 rounded-xl border border-l-line bg-l-card p-5">
                  <p className="text-[13px] text-l-subtle">What we do</p>
                  <ul className="mt-3 space-y-2.5 text-[14px]">
                    {[
                      "Turn a plain-language brief into terms both sides can check",
                      "Hold the payment with PayPal before any work starts",
                      "Verify delivered work with evidence, not opinions",
                      "Release exactly what was earned, and record every step",
                    ].map((t) => (
                      <li key={t} className="flex gap-2.5">
                        <IconCheck className="mt-0.5 size-4 shrink-0 text-l-ok" />
                        <span className="text-l-muted">{t}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href="https://synchstacksolutionslabs.vercel.app/"
                    className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium hover:underline"
                  >
                    Elom Labs <IconArrow className="size-3.5" />
                  </a>
                </div>
              </div>

              <div>
                <Eyebrow>What we build on</Eyebrow>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-l-muted">
                  We picked boring, proven infrastructure and kept the clever parts small. Here is what each
                  piece does in Ahadi today.
                </p>
                <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-l-line bg-l-line sm:grid-cols-2">
                  {STACK.map((t) => (
                    <div key={t.name} className="bg-l-card p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-[16px] font-semibold tracking-[-0.02em]">{t.name}</h3>
                        <span className="font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.08em] text-l-subtle">
                          {t.role}
                        </span>
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {t.points.map((pt) => (
                          <li key={pt} className="flex gap-2 text-[13.5px] leading-relaxed text-l-muted">
                            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-l-subtle" />
                            {pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* try it */}
        <section id="try" className="scroll-mt-20 border-t border-l-line bg-l-bg2/60">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
            <SectionHead
              eyebrow="Try it"
              title="Walk through a full promise in ten minutes."
              body={
                <>
                  Use the demo accounts on the sign-in page: switch between client, worker and reviewer with
                  one click. Pay with a PayPal sandbox buyer account. The full guide is in the{" "}
                  <a
                    href="https://github.com/JosephNjorog/Ahadi#test-it-yourself"
                    className="font-medium text-l-fg underline decoration-l-line2 underline-offset-4 hover:decoration-l-fg"
                  >
                    README
                  </a>
                  .
                </>
              }
            />
            <ol className="overflow-hidden rounded-xl border border-l-line bg-l-card">
              {[
                [
                  "Sign in as the client",
                  "Create a promise from a one-line brief. Review the drafted criteria and send the invite.",
                ],
                ["Switch to the worker", "Open the invite and sign the same terms."],
                [
                  "Fund it as the client",
                  "Approve the PayPal authorization with a sandbox buyer account. The money is held.",
                ],
                [
                  "Submit as the worker",
                  "Paste a URL. Try /fixtures/bakery-site-v1/ (fails on phones) or v2 (passes).",
                ],
                [
                  "Watch it verify",
                  "Follow each check live. Decide anything that needs a reviewer from the admin view.",
                ],
                [
                  "Accept and get paid",
                  "Both sides accept the proposal. PayPal captures the earned part and pays out.",
                ],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-4 border-b border-l-line p-4 last:border-b-0 sm:p-5">
                  <span className="font-[family-name:var(--font-geist-mono)] text-[12px] text-l-subtle">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="block text-[14px] font-medium">{t}</span>
                    <span className="mt-0.5 block text-[13.5px] text-l-muted">{b}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* cta */}
        <section className="border-t border-l-line">
          <div className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-5xl">
              Make the next job a promise.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[16px] text-l-muted">
              Secure the money, agree on done, and let the evidence decide.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Btn href={start}>
                {user ? "Open dashboard" : "Start a promise"} <IconArrow className="size-4" />
              </Btn>
              <Btn href="https://github.com/JosephNjorog/Ahadi" kind="outline">
                Read the code
              </Btn>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-l-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] text-l-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2 text-l-fg">
            <AhadiMark className="size-5" />
            <span className="font-semibold tracking-[-0.04em]">ahadi</span>
            <span className="text-l-subtle">· by Elom Labs, Nairobi</span>
          </span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
            <a href="/.well-known/ahadi-signing-key" className="hover:text-l-fg">
              Signing key
            </a>
            <a href="/api/health" className="hover:text-l-fg">
              Status
            </a>
            <a href="https://github.com/JosephNjorog/Ahadi" className="hover:text-l-fg">
              GitHub
            </a>
            <span>PayPal sandbox build</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
