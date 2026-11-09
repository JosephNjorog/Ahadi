import type { Metadata } from "next";
import Link from "next/link";
import { MilestoneStatusBadge, PromiseStatusBadge } from "@/components/promise/status-badge";
import { ButtonLink, EmptyState } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { IconChevron, IconList, IconPlus, IconSearch } from "@/components/ui/icons";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { PROMISE_STATUS } from "@/lib/status";
import { loadSummary } from "@/lib/summary";

export const metadata: Metadata = { title: "Promises" };

const VIEWS = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs you" },
  { key: "client", label: "As client" },
  { key: "worker", label: "As worker" },
  { key: "active", label: "Active" },
  { key: "done", label: "Completed" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function PromisesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const user = await requireUser("/promises");
  const { q = "", view: rawView } = await searchParams;
  const view: View = (VIEWS.find((v) => v.key === rawView)?.key ?? "all") as View;
  const s = await loadSummary(user.id);
  const needsYou = new Set(s.attention.map((a) => a.promiseId));
  const needle = q.trim().toLowerCase();

  const matchesView = (p: (typeof s.promises)[number]) => {
    switch (view) {
      case "attention":
        return needsYou.has(p.id);
      case "client":
        return p.role === "client";
      case "worker":
        return p.role === "worker";
      case "active":
        return !["COMPLETED", "CANCELLED"].includes(p.state);
      case "done":
        return p.state === "COMPLETED";
      default:
        return true;
    }
  };
  const matchesQuery = (p: (typeof s.promises)[number]) => {
    if (!needle) return true;
    const hay = [
      p.title,
      p.category,
      p.state,
      PROMISE_STATUS[p.state as keyof typeof PROMISE_STATUS]?.label ?? "",
      p.client?.displayName ?? "",
      p.worker?.displayName ?? "",
      p.inviteEmail ?? "",
      ...p.milestones.map((m) => `${m.title} ${m.state}`),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  };
  const rows = s.promises.filter((p) => matchesView(p) && matchesQuery(p));
  const countFor = (v: View) =>
    s.promises.filter((p) => {
      switch (v) {
        case "attention":
          return needsYou.has(p.id);
        case "client":
          return p.role === "client";
        case "worker":
          return p.role === "worker";
        case "active":
          return !["COMPLETED", "CANCELLED"].includes(p.state);
        case "done":
          return p.state === "COMPLETED";
        default:
          return true;
      }
    }).length;
  const hrefFor = (v: View) => {
    const sp = new URLSearchParams();
    if (v !== "all") sp.set("view", v);
    if (q) sp.set("q", q);
    const qs = sp.toString();
    return `/promises${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.035em]">Promises</h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            Every job is a promise: signed criteria, PayPal-secured funds, verified release.
          </p>
        </div>
        <ButtonLink href="/promises/new">
          <IconPlus className="size-4" /> New promise
        </ButtonLink>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter promises" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          {VIEWS.map((v) => {
            const active = v.key === view;
            const n = countFor(v.key);
            return (
              <Link
                key={v.key}
                href={hrefFor(v.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "bg-surface font-medium text-ink shadow-[var(--shadow-card)] ring-1 ring-line"
                    : "text-ink-muted hover:bg-raised hover:text-ink",
                )}
              >
                {v.label}
                <span
                  className={cn(
                    "tabular rounded-full px-1.5 text-[11px]",
                    active ? "bg-raised" : "bg-raised/60",
                    v.key === "attention" && n ? "bg-danger-50 text-danger-600" : "",
                  )}
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </nav>
        <form className="relative w-full sm:w-72" action="/promises">
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            name="q"
            defaultValue={q}
            type="search"
            placeholder="Filter by title, person, state…"
            aria-label="Filter promises"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[14px] outline-none placeholder:text-ink-subtle focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
        </form>
      </div>

      {s.promises.length === 0 ? (
        <EmptyState
          title="No promises yet"
          icon={<IconList className="size-8" />}
          action={
            <ButtonLink href="/promises/new">
              <IconPlus className="size-4" /> Start your first promise
            </ButtonLink>
          }
        >
          When someone invites you to a promise, or you create one, it shows up here.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          icon={<IconSearch className="size-8" />}
          action={
            <ButtonLink href="/promises" variant="secondary">
              Clear filters
            </ButtonLink>
          }
        >
          {needle ? <>No promises match “{q}” in this view.</> : "No promises in this view yet."}
        </EmptyState>
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
          <ul className="divide-y divide-line">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/promises/${p.id}`}
                  className="flex flex-col gap-3 px-5 py-4 hover:bg-raised/60 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[15px] font-medium">{p.title}</p>
                      <PromiseStatusBadge state={p.state} />
                      {needsYou.has(p.id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-[11.5px] font-medium text-danger-600">
                          <span className="size-1.5 rounded-full bg-danger-600" /> Needs you
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {p.role === "client"
                        ? "You're the client"
                        : p.role === "worker"
                          ? "You're the worker"
                          : "Reviewer view"}{" "}
                      · {p.category} ·{" "}
                      {p.role === "worker"
                        ? `client ${p.client?.displayName ?? "—"}`
                        : `worker ${p.worker?.displayName ?? p.inviteEmail ?? "invited"}`}{" "}
                      · created {formatDate(p.createdAt)}
                    </p>
                    {p.milestones.length ? (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
                        {p.milestones.map((m) => (
                          <span
                            key={m.id}
                            className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted"
                          >
                            M{m.position} <MilestoneStatusBadge state={m.state} />
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4 sm:text-right">
                    <div>
                      <p className="tabular text-[17px] font-semibold tracking-[-0.02em]">
                        {formatMoney(p.totalMinor, p.currency)}
                      </p>
                      {p.heldMinor > 0 ? (
                        <p className="text-[12px] text-brand-600">
                          {formatMoney(p.heldMinor, p.currency)} secured
                        </p>
                      ) : null}
                    </div>
                    <IconChevron className="hidden size-4 text-ink-subtle sm:block" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
