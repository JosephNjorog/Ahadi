import type { Metadata } from "next";
import Link from "next/link";
import { listAgents, myServices, searchProviders } from "@ahadi/services";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, Input, Select } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { ServiceForm } from "./service-form";

export const metadata: Metadata = { title: "Marketplace" };

const CATS = ["web", "code", "design", "writing", "research", "data"];

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; maxPriceUsd?: string; minScore?: string }>;
}) {
  const user = await requireUser("/marketplace");
  const sp = await searchParams;
  const actor = actorFor(user);
  const category = CATS.includes(sp.category ?? "") ? sp.category : undefined;
  const providers = await searchProviders({
    category,
    query: sp.q || undefined,
    maxPriceUsd: sp.maxPriceUsd ? Number(sp.maxPriceUsd) : undefined,
    minScore: sp.minScore ? Number(sp.minScore) : undefined,
  });
  const [mine, agents] = await Promise.all([myServices(actor), listAgents(actor)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marketplace</h1>
        <p className="mt-1 text-sm text-ink-muted">
          People and agents offering work with verifiable deliverables, ranked by verified track record — not
          reviews.
        </p>
      </div>
      <form className="grid gap-2 sm:grid-cols-5" method="get">
        <Input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search services"
          className="sm:col-span-2"
          aria-label="Search"
        />
        <Select name="category" defaultValue={category ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          name="maxPriceUsd"
          defaultValue={sp.maxPriceUsd ?? ""}
          placeholder="Max price $"
          inputMode="decimal"
          aria-label="Maximum price"
        />
        <button
          type="submit"
          className="h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Search
        </button>
      </form>
      {providers.length === 0 ? (
        <EmptyState title="No services match">Try another category, or offer your own below.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <Card key={p.serviceId}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.title}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {p.provider.name} <Badge className="ml-1">{p.provider.kind}</Badge>{" "}
                      {p.provider.country ? <span className="text-xs">· {p.provider.country}</span> : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-lg font-semibold">{formatMoney(p.priceUsd * 100)}</p>
                    <p className="text-xs text-ink-muted">{p.turnaroundHours}h turnaround</p>
                  </div>
                </div>
                <p className="line-clamp-3 text-sm text-ink-muted">{p.description}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="brand">score {p.score.toFixed(2)}</Badge>
                  <Badge>{p.settledCount} verified</Badge>
                  <Badge>first-pass {Math.round(p.firstPassRate * 100)}%</Badge>
                  {p.provider.passport ? (
                    <Link
                      href={p.provider.passport}
                      className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                    >
                      Passport
                    </Link>
                  ) : null}
                </div>
                <ButtonLink href={`/promises/new?service=${p.serviceId}`} size="sm">
                  Hire with a promise
                </ButtonLink>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader
          title="Your services"
          description="Offer work others can hire you (or your provider agent) for. Template criteria become the Architect's starting point."
        />
        <CardBody className="space-y-4">
          {mine.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {mine.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span>
                    {s.title} <Badge className="ml-1">{s.category}</Badge>{" "}
                    {s.active ? null : <Badge tone="neutral">inactive</Badge>}
                  </span>
                  <span className="tabular">{formatMoney(s.priceMinor, s.currency)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <ServiceForm
            providerAgents={agents
              .filter((a) => a.kind !== "buyer" && !a.revokedAt)
              .map((a) => ({ id: a.id, name: a.name }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
