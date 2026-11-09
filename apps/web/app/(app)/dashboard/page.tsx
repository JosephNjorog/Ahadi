import type { Metadata } from "next";
import Link from "next/link";
import { MoneyChart, Sparkline } from "@/components/dashboard/charts";
import { PromiseStatusBadge } from "@/components/promise/status-badge";
import { Alert, ButtonLink, EmptyState } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import {
  IconAlert,
  IconArrow,
  IconCheck,
  IconChevron,
  IconClock,
  IconDoc,
  IconInbox,
  IconLock,
  IconPlus,
  IconRepeat,
  IconScan,
  IconShield,
  IconStore,
  IconWallet,
} from "@/components/ui/icons";
import { requireUser } from "@/lib/auth";
import { formatMoney, relativeTime, shortHash } from "@/lib/format";
import { loadSummary } from "@/lib/summary";
import type { AttentionItem } from "@ahadi/services";

export const metadata: Metadata = { title: "Home" };

const TZ = "Africa/Nairobi";

function greeting(now: Date) {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(now),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "$1,234.56" → big whole part with small currency sign and cents, like a statement. */
function BigMoney({ minor, currency, size = "lg" }: { minor: number; currency: string; size?: "xl" | "lg" }) {
  const s = formatMoney(minor, currency);
  const m = s.match(/^([^\d-]*)(-?[\d,]+)(?:\.(\d+))?(.*)$/);
  const [sym, whole, cents] = m ? [m[1], m[2], m[3]] : ["", s, undefined];
  return (
    <span className="tabular inline-flex items-baseline">
      <span className={cn("mr-1 text-current/55", size === "xl" ? "text-2xl" : "text-base")}>
        {sym?.trim()}
      </span>
      <span
        className={cn(
          "font-semibold",
          size === "xl"
            ? "text-[56px] leading-none tracking-[-0.045em]"
            : "text-[28px] leading-none tracking-[-0.035em]",
        )}
      >
        {whole}
      </span>
      {cents ? (
        <span className={cn("text-current/45", size === "xl" ? "text-2xl" : "text-base")}>.{cents}</span>
      ) : null}
    </span>
  );
}

const ATTENTION_ICON: Record<AttentionItem["kind"], typeof IconWallet> = {
  sign_terms: IconDoc,
  fund: IconWallet,
  submit: IconInbox,
  resubmit: IconRepeat,
  decide: IconScan,
  review: IconShield,
  hold_expiring: IconClock,
  settlement_failed: IconAlert,
  mediation: IconRepeat,
};

const TONE_CHIP: Record<AttentionItem["tone"], string> = {
  danger: "bg-danger-50 text-danger-600",
  warn: "bg-warn-50 text-warn-600",
  info: "bg-raised text-ink-muted",
};

function humanEvent(type: string) {
  const t = type.replace(/[._]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function StatCard({
  label,
  icon: I,
  children,
  hint,
  spark,
  tone,
}: {
  label: string;
  icon: typeof IconWallet;
  children: React.ReactNode;
  hint: React.ReactNode;
  spark?: number[];
  tone?: "ink" | "brand" | "danger";
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between px-5 pt-4">
        <p className="text-[13px] text-ink-muted">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted">
          <I className="size-4" />
        </span>
      </div>
      <div className="px-5 pt-2">{children}</div>
      <p className="px-5 pb-3 pt-1.5 text-[12.5px] text-ink-muted">{hint}</p>
      {spark ? (
        <Sparkline values={spark} tone={tone} className="mt-auto h-12 w-full" />
      ) : (
        <div className="mt-auto h-3" />
      )}
    </div>
  );
}

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  const s = await loadSummary(user.id);
  const now = new Date();
  const first =
    user.displayName
      .replace(/\(.*\)/, "")
      .trim()
      .split(/\s+/)[0] ?? "";
  const cur = s.money.currency;
  const isWorkerHeavy = s.counts.asWorker > s.counts.asClient;
  const recent = s.promises.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-muted">
            {new Intl.DateTimeFormat("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: TZ,
            }).format(now)}
          </p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.035em] sm:text-[32px]">
            {greeting(now)}
            {first ? `, ${first}` : ""}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            <span className="font-medium text-ink">
              {s.counts.promises} promise{s.counts.promises === 1 ? "" : "s"}
            </span>
            {" · "}
            {formatMoney(s.money.heldMinor, cur)} held with PayPal
            {" · "}
            Updated {new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: TZ }).format(now)}
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/marketplace" variant="secondary">
            <IconStore className="size-4" /> Marketplace
          </ButtonLink>
          <ButtonLink href="/promises/new">
            <IconPlus className="size-4" /> New promise
          </ButtonLink>
        </div>
      </div>

      {!user.paypalEmail ? (
        <Alert
          tone="warn"
          title="Add your PayPal email to get paid"
          action={
            <ButtonLink href="/settings" size="sm" variant="secondary">
              Open settings
            </ButtonLink>
          }
        >
          Payouts for promises you deliver go to this address.
        </Alert>
      ) : null}

      {s.promises.length === 0 ? (
        <EmptyState
          title="No promises yet"
          icon={<IconDoc className="size-8" />}
          action={
            <ButtonLink href="/promises/new">
              <IconPlus className="size-4" /> Start your first promise
            </ButtonLink>
          }
        >
          Describe a job in plain words. Ahadi drafts checkable criteria, PayPal holds the money, and it is
          released only for verified work. Promises you&apos;re invited to also show up here.
        </EmptyState>
      ) : (
        <>
          {/* money */}
          <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr] [&>*]:min-w-0">
            <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] bg-accent text-accent-fg shadow-[var(--shadow-card)] lg:row-span-2">
              <div className="px-6 pt-5">
                <p className="flex items-center gap-2 text-[13px] opacity-70">
                  Held with PayPal
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-[11px]">
                    <span className="size-1.5 rounded-full bg-brand-500" /> authorized
                  </span>
                </p>
                <p className="mt-4">
                  <BigMoney minor={s.money.heldMinor} currency={cur} size="xl" />
                </p>
                <p className="mt-3 text-[13px] opacity-70">
                  {s.counts.held
                    ? `${s.counts.held} milestone${s.counts.held === 1 ? "" : "s"} secured · captured only when verified`
                    : "Nothing held right now · fund a milestone to secure money"}
                </p>
              </div>
              <div className="mt-auto px-2 pt-6 text-accent-fg [&_path]:[stroke:currentColor] [&_path:first-child]:[fill:currentColor]">
                <Sparkline values={s.series.secured} className="h-14 w-full lg:h-24" />
              </div>
              <div className="grid grid-cols-3 border-t border-current/15 text-[12.5px]">
                {[
                  ["Active", s.counts.active],
                  ["In verification", s.counts.inVerification],
                  ["Settled", s.counts.settled],
                ].map(([k, v]) => (
                  <div key={String(k)} className="border-r border-current/15 px-5 py-3.5 last:border-r-0">
                    <p className="opacity-60">{k}</p>
                    <p className="tabular mt-0.5 text-[17px] font-semibold">{v}</p>
                  </div>
                ))}
              </div>
            </div>

            <StatCard
              label="Captured for verified work"
              icon={IconCheck}
              hint={`PayPal fees ${formatMoney(s.money.paypalFeesMinor, cur)}`}
              spark={s.series.captured}
              tone="brand"
            >
              <BigMoney minor={s.money.capturedMinor} currency={cur} />
            </StatCard>
            <StatCard
              label={isWorkerHeavy ? "Paid to you" : "Paid out to workers"}
              icon={IconWallet}
              hint={isWorkerHeavy ? "Through PayPal Payouts" : "Through PayPal Payouts, after fees"}
            >
              <BigMoney minor={isWorkerHeavy ? s.money.earnedMinor : s.money.paidOutMinor} currency={cur} />
            </StatCard>
            <StatCard label="Returned to clients" icon={IconLock} hint="Released from holds, never captured">
              <BigMoney minor={s.money.returnedMinor} currency={cur} />
            </StatCard>
            <StatCard
              label="Criteria passed"
              icon={IconShield}
              hint={
                s.verification.decided
                  ? `${s.verification.byMachine} machine · ${s.verification.byAgent} AI · ${s.verification.byHuman} human`
                  : "No verifications yet"
              }
            >
              <span className="tabular text-[28px] font-semibold leading-none tracking-[-0.035em]">
                {s.verification.passRate == null ? "—" : `${Math.round(s.verification.passRate * 100)}%`}
              </span>
              {s.verification.decided ? (
                <span className="ml-2 text-[13px] text-ink-muted">
                  {s.verification.passed} of {s.verification.decided}
                </span>
              ) : null}
            </StatCard>
          </div>

          {/* chart + attention */}
          <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr] [&>*]:min-w-0">
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Money flow</h2>
                  <p className="text-[13px] text-ink-muted">Last 30 days, cumulative</p>
                </div>
                <div className="flex items-center gap-4 text-[12.5px] text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded bg-ink" /> Captured
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-ink-subtle" /> Secured
                  </span>
                </div>
              </div>
              <p className="mt-4 text-[12.5px] text-ink-muted">Captured to date</p>
              <p className="mt-0.5">
                <BigMoney minor={s.series.captured.at(-1) ?? 0} currency={cur} />
                <span className="ml-3 text-[13px] text-ink-muted">
                  of {formatMoney(s.series.secured.at(-1) ?? 0, cur)} secured
                </span>
              </p>
              <div className="mt-3 hidden sm:block">
                <MoneyChart
                  start={s.series.start}
                  secured={s.series.secured}
                  captured={s.series.captured}
                  currency={cur}
                />
              </div>
              <div className="mt-3 sm:hidden">
                <MoneyChart
                  compact
                  start={s.series.start}
                  secured={s.series.secured}
                  captured={s.series.captured}
                  currency={cur}
                />
              </div>
            </section>

            <section className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between px-5 pt-5">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Needs attention</h2>
                  <p className="text-[13px] text-ink-muted">
                    {s.attention.length ? `${s.attention.length} waiting on you` : "You're all caught up"}
                  </p>
                </div>
                {s.attention.length ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-50 px-2 py-0.5 text-[12px] font-medium text-danger-600">
                    <span className="size-1.5 rounded-full bg-danger-600" /> {s.attention.length}
                  </span>
                ) : null}
              </div>
              {s.attention.length ? (
                <ul className="mt-3 px-2 pb-2">
                  {s.attention.slice(0, 6).map((a, i) => {
                    const I = ATTENTION_ICON[a.kind];
                    return (
                      <li key={`${a.kind}-${a.href}-${i}`}>
                        <Link
                          href={a.href}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-raised"
                        >
                          <span
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-lg",
                              TONE_CHIP[a.tone],
                            )}
                          >
                            <I className="size-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium">{a.title}</span>
                            <span className="block truncate text-[12px] text-ink-muted">{a.detail}</span>
                          </span>
                          <IconChevron className="size-4 shrink-0 text-ink-subtle" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <IconCheck className="size-5" />
                  </span>
                  <p className="mt-3 text-[13.5px] font-medium">Nothing needs you right now</p>
                  <p className="mt-1 text-[12.5px] text-ink-muted">
                    New invites, funding and verdicts will appear here.
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* promises + activity */}
          <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr] [&>*]:min-w-0">
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between px-5 pt-5">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Recent promises</h2>
                  <p className="text-[13px] text-ink-muted">Latest activity first</p>
                </div>
                <Link
                  href="/promises"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-muted hover:text-ink"
                >
                  View all <IconArrow className="size-3.5" />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line border-t border-line sm:hidden">
                {recent.map((p) => {
                  const done = p.milestones.filter((m) => m.state === "SETTLED").length;
                  return (
                    <li key={p.id}>
                      <Link href={`/promises/${p.id}`} className="block px-5 py-3.5 hover:bg-raised/60">
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 truncate text-[14px] font-medium">{p.title}</span>
                          <span className="tabular shrink-0 text-[14px] font-medium">
                            {formatMoney(p.totalMinor, p.currency)}
                          </span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                          <PromiseStatusBadge state={p.state} />
                          <span>
                            {p.role === "client" ? "Client" : p.role === "worker" ? "Worker" : "Reviewer"} ·{" "}
                            {done}/{p.milestones.length} settled
                          </span>
                          {p.heldMinor > 0 ? (
                            <span className="text-brand-600">
                              {formatMoney(p.heldMinor, p.currency)} secured
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[620px] text-[13.5px]">
                  <thead>
                    <tr className="border-y border-line text-left text-[12px] text-ink-subtle">
                      <th className="px-5 py-2.5 font-normal">Promise</th>
                      <th className="px-3 py-2.5 font-normal">You are</th>
                      <th className="px-3 py-2.5 font-normal">Status</th>
                      <th className="px-3 py-2.5 font-normal">Milestones</th>
                      <th className="px-5 py-2.5 text-right font-normal">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((p) => {
                      const done = p.milestones.filter((m) => m.state === "SETTLED").length;
                      const total = p.milestones.length;
                      return (
                        <tr key={p.id} className="border-b border-line last:border-b-0 hover:bg-raised/60">
                          <td className="px-5 py-3">
                            <Link href={`/promises/${p.id}`} className="block min-w-0">
                              <span className="block max-w-[260px] truncate font-medium hover:underline">
                                {p.title}
                              </span>
                              <span className="block truncate text-[12px] text-ink-muted">
                                {p.category} ·{" "}
                                {p.role === "worker"
                                  ? `client ${p.client?.displayName ?? "—"}`
                                  : `worker ${p.worker?.displayName ?? "invited"}`}
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-ink-muted">
                            {p.role === "client" ? "Client" : p.role === "worker" ? "Worker" : "Reviewer"}
                          </td>
                          <td className="px-3 py-3">
                            <PromiseStatusBadge state={p.state} />
                          </td>
                          <td className="px-3 py-3">
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
                                <span
                                  className="block h-full rounded-full bg-ink"
                                  style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
                                />
                              </span>
                              <span className="tabular text-[12px] text-ink-muted">
                                {done}/{total}
                              </span>
                            </span>
                          </td>
                          <td className="tabular px-5 py-3 text-right">
                            <span className="font-medium">{formatMoney(p.totalMinor, p.currency)}</span>
                            {p.heldMinor > 0 ? (
                              <span className="block text-[12px] text-brand-600">
                                {formatMoney(p.heldMinor, p.currency)} secured
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
              <div className="px-5 pt-5">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Ledger activity</h2>
                <p className="text-[13px] text-ink-muted">Hash-chained, newest first</p>
              </div>
              {s.activity.length ? (
                <ol className="relative mt-4 space-y-4 px-5 pb-5">
                  <span className="absolute bottom-6 left-[27px] top-2 w-px bg-line" aria-hidden="true" />
                  {s.activity.slice(0, 7).map((e) => (
                    <li key={e.id} className="relative flex gap-3">
                      <span className="relative mt-1 flex size-2.5 shrink-0 rounded-full border-2 border-surface bg-ink ring-1 ring-line" />
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/promises/${e.promiseId}/ledger`}
                          className="block truncate text-[13px] font-medium hover:underline"
                        >
                          {humanEvent(e.type)}
                        </Link>
                        <span className="block truncate text-[12px] text-ink-muted">
                          {e.promiseTitle} · {e.actor}
                        </span>
                        <span className="block font-[family-name:var(--font-geist-mono)] text-[11px] text-ink-subtle">
                          {relativeTime(e.at)} · {shortHash(e.hash, 8)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-5 py-8 text-center text-[13px] text-ink-muted">No ledger events yet.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
