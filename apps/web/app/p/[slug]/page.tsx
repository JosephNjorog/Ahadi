import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAppError } from "@ahadi/core";
import { getPassportBySlug, type PassportStats } from "@ahadi/services";
import { Logo } from "@/components/layout/logo";
import { Badge, Card, CardBody, CardHeader, Stat } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  try {
    return await getPassportBySlug(slug);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  return {
    title: `${(p.stats as PassportStats).displayName} — Ahadi Passport`,
    description: `${p.stats.settledCount} verified, paid promises on Ahadi.`,
  };
}

/** Public Ahadi Passport (SPEC §15). */
export default async function PassportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await load(slug);
  const s = p.stats as PassportStats & { totalVerifiedMinor: number | null; seededDemoHistory?: boolean };
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-4xl items-center px-4">
        <Logo />
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Ahadi Passport</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{s.displayName}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {s.country ? `${s.country} · ` : ""}member since {formatDate(s.memberSince)}
              {s.lastActive ? ` · last active ${formatDate(s.lastActive)}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-ink-subtle">Verified score</p>
            <p className="tabular text-4xl font-semibold text-brand-700">{p.score.toFixed(2)}</p>
          </div>
        </div>
        {s.seededDemoHistory ? <Badge tone="warn">Demo provider with seeded history</Badge> : null}
        <section className="grid gap-3 sm:grid-cols-4">
          <Stat label="Verified promises" value={s.settledCount} />
          <Stat
            label="First-pass rate"
            value={`${Math.round(s.firstPassRate * 100)}%`}
            hint="fully verified on attempt 1"
          />
          <Stat label="Average release" value={`${Math.round(s.avgReleaseRate * 100)}%`} />
          <Stat
            label="Verified value"
            value={s.totalVerifiedMinor != null ? formatMoney(s.totalVerifiedMinor) : s.totalVerifiedBucket}
          />
        </section>
        <Card>
          <CardHeader
            title="Recent verified work"
            description="Client names are masked. Each entry was paid only after verification against signed criteria."
          />
          {s.recentWork.length ? (
            <ul className="divide-y divide-line">
              {s.recentWork.map((w, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{w.title}</span>{" "}
                    <Badge className="ml-1">{w.category}</Badge>
                  </span>
                  <span className="text-ink-muted">
                    {w.releasePct}% released · {w.client} · {formatDate(w.settledAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-ink-muted">No settled promises yet.</p>
            </CardBody>
          )}
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="Work types" />
            <CardBody className="flex flex-wrap gap-2">
              {Object.entries(s.categories).map(([k, n]) => (
                <Badge key={k}>{`${k} · ${n}`}</Badge>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Disputes" />
            <CardBody className="text-sm text-ink-muted">
              {s.disputes.opened} opened · {s.disputes.resolvedInFavor} resolved in their favour
            </CardBody>
          </Card>
        </div>
        <p className="text-xs text-ink-subtle">
          Computed by Ahadi from settled promises · updated {formatDate(p.recomputedAt)} ·{" "}
          <a href={`/api/passport/${slug}`} className="underline">
            JSON
          </a>{" "}
          · statements are signed with the key at{" "}
          <a href="/.well-known/ahadi-signing-key" className="underline">
            /.well-known/ahadi-signing-key
          </a>
        </p>
      </main>
    </div>
  );
}
