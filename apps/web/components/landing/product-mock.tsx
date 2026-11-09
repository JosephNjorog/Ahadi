import {
  IconBell,
  IconChain,
  IconCheck,
  IconChevron,
  IconClock,
  IconDoc,
  IconHome,
  IconLock,
  IconSearch,
  IconShield,
  IconUser,
  IconWallet,
  IconX,
} from "@/components/ui/icons";

/**
 * A static, non-interactive picture of the Ahadi promise screen. The numbers are
 * the ones from a real sandbox run: $40 authorized, 4 of 5 criteria met,
 * $32.00 captured, $29.91 paid out to the worker.
 */

const CRITERIA = [
  { key: "c1", title: "Site is reachable", note: "HTTP 200", by: "Machine", ok: true, w: 15 },
  { key: "c2", title: "Hero names the bakery", note: "confidence 0.85", by: "Verifier", ok: true, w: 20 },
  { key: "c3", title: "3+ cakes with KES prices", note: "confidence 0.90", by: "Verifier", ok: true, w: 25 },
  { key: "c4", title: "Contact form submits", note: "200 on POST", by: "Reviewer", ok: true, w: 20 },
  {
    key: "c5",
    title: "No sideways scroll at 375px",
    note: "720px strip overflows",
    by: "Reviewer",
    ok: false,
    w: 20,
  },
];

const LEDGER = [
  { t: "11:06:41", ev: "payout.succeeded", actor: "paypal", amount: "29.91", hash: "9f2c…e1a0" },
  { t: "11:06:29", ev: "settlement.captured", actor: "system", amount: "32.00", hash: "41bd…77c3" },
  { t: "11:06:27", ev: "proposal.accepted", actor: "worker", amount: "—", hash: "c08e…5d19" },
  { t: "11:05:58", ev: "proposal.accepted", actor: "client", amount: "—", hash: "7a61…b2f4" },
];

const NAV = [
  { label: "Promises", icon: IconHome, active: true },
  { label: "Funding", icon: IconWallet },
  { label: "Verification", icon: IconShield },
  { label: "Ledger", icon: IconChain },
  { label: "Passport", icon: IconUser },
];

/** Deterministic little sparkline path so the mock renders identically on server and client. */
function spark(points: number[], w = 260, h = 44) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const step = w / (points.length - 1);
  const y = (v: number) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
  let d = `M0 ${y(points[0]!).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y(points[i - 1]!).toFixed(1)} ${cx.toFixed(1)} ${y(points[i]!).toFixed(1)} ${x1.toFixed(1)} ${y(points[i]!).toFixed(1)}`;
  }
  return { line: d, area: `${d} L${w} ${h} L0 ${h} Z` };
}

function Spark({ points, tone = "fg" }: { points: number[]; tone?: "fg" | "ok" | "bad" }) {
  const { line, area } = spark(points);
  const color = tone === "ok" ? "var(--lp-ok)" : tone === "bad" ? "var(--lp-bad)" : "var(--lp-fg)";
  return (
    <svg viewBox="0 0 260 44" preserveAspectRatio="none" className="h-11 w-full" aria-hidden="true">
      <path d={area} fill={color} opacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Money({ v, cur = "$", big }: { v: string; cur?: string; big?: boolean }) {
  const [whole, cents] = v.split(".");
  return (
    <span className="tabular inline-flex items-baseline">
      <span className={big ? "mr-1 text-xl text-l-muted" : "mr-0.5 text-xs text-l-muted"}>{cur}</span>
      <span
        className={
          big ? "text-5xl font-semibold tracking-[-0.04em]" : "text-2xl font-semibold tracking-[-0.03em]"
        }
      >
        {whole}
      </span>
      {cents ? (
        <span className={big ? "text-xl text-l-subtle" : "text-sm text-l-subtle"}>.{cents}</span>
      ) : null}
    </span>
  );
}

export function ProductMock() {
  return (
    <div
      className="shadow-l overflow-hidden rounded-xl border border-l-line bg-l-card text-left"
      role="img"
      aria-label="Preview of an Ahadi promise: $40 held with PayPal, 4 of 5 criteria verified, $32 captured and $29.91 paid to the worker."
    >
      {/* window chrome */}
      <div className="flex h-10 items-center gap-2 border-b border-l-line px-4">
        <span className="size-2.5 rounded-full bg-l-line2" />
        <span className="size-2.5 rounded-full bg-l-line2" />
        <span className="size-2.5 rounded-full bg-l-line2" />
        <span className="mx-auto hidden rounded-md border border-l-line px-3 py-0.5 font-[family-name:var(--font-geist-mono)] text-[11px] text-l-subtle sm:block">
          ahadi-web.onrender.com/promises/e6c3dfa0
        </span>
      </div>

      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-52 shrink-0 border-r border-l-line p-3 lg:block">
          <div className="flex items-center gap-2 rounded-lg border border-l-line p-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-l-inv text-[11px] font-semibold text-l-inv-fg">
              MN
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium">Mama Njeri&apos;s Bakery</span>
              <span className="block text-[11px] text-l-subtle">Client · Kilimani</span>
            </span>
          </div>
          <p className="mt-5 px-2 text-[10px] font-medium uppercase tracking-[0.08em] text-l-subtle">
            Workspace
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {NAV.map(({ label, icon: I, active }) => (
              <li
                key={label}
                className={
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] " +
                  (active ? "border border-l-line bg-l-bg font-medium" : "text-l-muted")
                }
              >
                <I className="size-4" />
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-24 rounded-lg border border-l-line p-2.5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
              <span className="size-1.5 rounded-full bg-l-ok" /> Ledger verified
            </p>
            <p className="mt-0.5 text-[11px] text-l-subtle">18 events · chain intact</p>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          <div className="flex h-12 items-center gap-3 border-b border-l-line px-4">
            <span className="flex h-7 w-full max-w-64 items-center gap-2 rounded-md border border-l-line px-2 text-[12px] text-l-subtle">
              <IconSearch className="size-3.5" /> Search promises…
              <kbd className="ml-auto rounded border border-l-line px-1 font-[family-name:var(--font-geist-mono)] text-[10px]">
                ⌘K
              </kbd>
            </span>
            <span className="ml-auto flex size-7 items-center justify-center rounded-md text-l-muted">
              <IconBell className="size-4" />
            </span>
          </div>

          <div className="p-4 sm:p-6">
            <p className="text-[12px] text-l-subtle">Promises / Nairobi Bakery Landing Page</p>
            <div className="mt-1.5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
                  Landing page delivered and live
                </h3>
                <p className="mt-1 text-[12.5px] text-l-muted">
                  <span className="font-medium text-l-fg">Milestone 1 of 1</span> · Worker: Amina W. · Settled
                  11:06
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-l-line px-2.5 py-1 text-[12px] font-medium">
                <span className="size-1.5 rounded-full bg-l-ok" /> Settled
              </span>
            </div>

            {/* stat row */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-[1.35fr_1fr_1fr] [&>*]:min-w-0">
              <div className="flex flex-col overflow-hidden rounded-xl bg-l-inv text-l-inv-fg sm:col-span-2 md:col-span-1 md:row-span-2">
                <div className="p-4">
                  <p className="flex items-center gap-2 text-[12px] opacity-70">
                    Held with PayPal
                    <span className="inline-flex items-center gap-1 rounded-full border border-current/20 px-1.5 py-px text-[10.5px] opacity-90">
                      <IconLock className="size-3" /> authorized
                    </span>
                  </p>
                  <p className="mt-3 [&_.text-l-muted]:text-current/60 [&_.text-l-subtle]:text-current/50">
                    <Money v="40.00" big />
                  </p>
                  <div className="mt-4">
                    <div className="flex justify-between text-[11px] opacity-70">
                      <span>Released 80%</span>
                      <span>Returned 20%</span>
                    </div>
                    <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-current/15">
                      <span className="h-full w-4/5 rounded-full bg-current" />
                    </div>
                  </div>
                </div>
                <div className="mt-auto hidden px-4 pb-1 opacity-80 md:block">
                  <svg
                    viewBox="0 0 260 44"
                    preserveAspectRatio="none"
                    className="h-12 w-full"
                    aria-hidden="true"
                  >
                    <path
                      d="M0 40 L60 40 L60 8 L208 8 L208 40 L260 40"
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity={0.35}
                      strokeDasharray="3 3"
                      strokeWidth={1.2}
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d="M0 40 L60 40 L60 8 L178 8 L178 40 L260 40"
                      fill="currentColor"
                      fillOpacity={0.12}
                      stroke="currentColor"
                      strokeWidth={1.4}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <div className="flex justify-between text-[10.5px] opacity-60">
                    <span>Authorized</span>
                    <span>Captured</span>
                    <span>Released</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 border-t border-current/15 text-[11.5px] md:mt-3">
                  {[
                    ["Captured", "$32.00"],
                    ["Returned", "$8.00"],
                    ["To worker", "$29.91"],
                  ].map(([k, v]) => (
                    <div key={k} className="border-r border-current/15 px-4 py-3 last:border-r-0">
                      <p className="opacity-60">{k}</p>
                      <p className="tabular mt-0.5 font-medium">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-l-line p-4">
                <p className="flex items-center justify-between text-[12px] text-l-muted">
                  Criteria met <IconShield className="size-4" />
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  4<span className="text-base text-l-subtle"> / 5</span>
                </p>
                <p className="mt-1 text-[11.5px] text-l-muted">80% of weight passed</p>
                <Spark points={[2, 3, 3, 5, 4, 6, 7, 7, 8, 9]} tone="ok" />
              </div>

              <div className="rounded-xl border border-l-line p-4">
                <p className="flex items-center justify-between text-[12px] text-l-muted">
                  Where the $32.00 went <IconWallet className="size-4" />
                </p>
                <p className="mt-2">
                  <Money v="29.91" />
                </p>
                <p className="mt-1 text-[11.5px] text-l-muted">Paid to the worker</p>
                <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                  <span className="h-full rounded-l-full bg-l-fg" style={{ width: "93.5%" }} />
                  <span className="h-full bg-l-bad" style={{ width: "5%" }} />
                  <span className="h-full rounded-r-full bg-l-subtle" style={{ width: "1.5%" }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-l-muted">
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-l-fg" /> Worker $29.91
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-l-bad" /> PayPal $1.61
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-l-subtle" /> Ahadi $0.48
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-l-line p-4">
                <p className="flex items-center justify-between text-[12px] text-l-muted">
                  Hold honored for <IconClock className="size-4" />
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  3<span className="text-base text-l-subtle"> days</span>
                </p>
                <p className="mt-1 text-[11.5px] text-l-muted">Then reauthorize, up to 29 days</p>
              </div>

              <div className="rounded-xl border border-l-line p-4">
                <p className="flex items-center justify-between text-[12px] text-l-muted">
                  Terms <IconDoc className="size-4" />
                </p>
                <p className="mt-2 font-[family-name:var(--font-geist-mono)] text-[15px] font-medium">
                  6c33…a256
                </p>
                <p className="mt-1 text-[11.5px] text-l-muted">Signed by both · version 1</p>
              </div>
            </div>

            {/* criteria + ledger */}
            <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
              <div className="rounded-xl border border-l-line">
                <div className="flex items-center justify-between px-4 pt-4">
                  <div>
                    <p className="text-[13.5px] font-semibold">Verification</p>
                    <p className="text-[11.5px] text-l-muted">Each criterion, with who decided it</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-l-bad-bg px-2 py-0.5 text-[11px] font-medium text-l-bad">
                    <span className="size-1.5 rounded-full bg-l-bad" /> 1 failed
                  </span>
                </div>
                <ul className="mt-2 px-2 pb-2">
                  {CRITERIA.map((c) => (
                    <li key={c.key} className="flex items-center gap-3 rounded-lg px-2 py-2">
                      <span
                        className={
                          "flex size-7 shrink-0 items-center justify-center rounded-md " +
                          (c.ok ? "bg-l-ok-bg text-l-ok" : "bg-l-bad-bg text-l-bad")
                        }
                      >
                        {c.ok ? <IconCheck className="size-4" /> : <IconX className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{c.title}</span>
                        <span className="block truncate text-[11px] text-l-muted">
                          {c.by} · {c.note}
                        </span>
                      </span>
                      <span className="tabular text-[11.5px] text-l-subtle">{c.w}%</span>
                      <IconChevron className="size-4 text-l-subtle" />
                    </li>
                  ))}
                </ul>
              </div>

              <div className="overflow-hidden rounded-xl border border-l-line">
                <div className="px-4 pt-4">
                  <p className="text-[13.5px] font-semibold">Ledger</p>
                  <p className="text-[11.5px] text-l-muted">Hash-chained, append-only</p>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[360px] text-[11.5px]">
                    <thead>
                      <tr className="border-y border-l-line text-left text-l-subtle">
                        <th className="px-4 py-2 font-normal">Event</th>
                        <th className="px-2 py-2 font-normal">Actor</th>
                        <th className="px-2 py-2 text-right font-normal">USD</th>
                        <th className="px-4 py-2 text-right font-normal">Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LEDGER.map((r) => (
                        <tr key={r.t + r.ev + r.actor} className="border-b border-l-line last:border-b-0">
                          <td className="px-4 py-2.5">
                            <span className="block font-[family-name:var(--font-geist-mono)] text-[11px]">
                              {r.ev}
                            </span>
                            <span className="text-[10.5px] text-l-subtle">{r.t}</span>
                          </td>
                          <td className="px-2 py-2.5 text-l-muted">{r.actor}</td>
                          <td className="tabular px-2 py-2.5 text-right">{r.amount}</td>
                          <td className="px-4 py-2.5 text-right font-[family-name:var(--font-geist-mono)] text-[10.5px] text-l-subtle">
                            {r.hash}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
