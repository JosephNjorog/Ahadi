import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: "1",
    title: "Agree what “done” means",
    body: "Describe the job in plain words. Ahadi turns it into milestones with checkable acceptance criteria. Both sides sign the same hashed terms.",
  },
  {
    n: "2",
    title: "Secure the money with PayPal",
    body: "The client approves a PayPal authorization. The money is held, not taken. The worker sees “Funds secured” before starting.",
  },
  {
    n: "3",
    title: "Release only verified work",
    body: "Verifier agents check the work against each criterion with evidence. Fixed rules capture the full amount, a fair part, or nothing — then pay the worker.",
  },
];

export default async function Landing() {
  const user = await currentUser();
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo />
        <ButtonLink
          href={user ? "/dashboard" : "/sign-in"}
          variant={user ? "primary" : "secondary"}
          size="sm"
        >
          {user ? "Open dashboard" : "Sign in"}
        </ButtonLink>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-20">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            Ahadi · Swahili for “promise”
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
            PayPal moves the money. <span className="text-brand-600">Ahadi decides when it should move.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            A trust layer for paying for work — done by people or by AI agents. Terms agreed in advance, funds
            secured through PayPal, money released only when the work is verified.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={user ? "/dashboard" : "/sign-in"} size="lg">
              Start a promise
            </ButtonLink>
            <ButtonLink href="#how" variant="secondary" size="lg">
              How it works
            </ButtonLink>
          </div>
        </section>

        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700">
                  {s.n}
                </span>
                <h2 className="mt-4 text-lg font-semibold">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Models never move money</h2>
            <p className="mt-3 text-ink-muted">
              AI agents produce verdicts with evidence. A deterministic settlement engine computes every
              amount. Only the settlement service can call PayPal — and every step is written to a
              hash-chained ledger anyone can verify.
            </p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              "Humans keep the veto: objection windows and confirmation above a threshold",
              "Low confidence or a hidden injection attempt blocks release",
              "Idempotent PayPal calls — retries never double-charge or double-pay",
              "Every settled promise builds the worker’s Ahadi Passport",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <span className="mt-0.5 text-brand-600" aria-hidden="true">
                  ✓
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-ink-subtle">
          <span>© {new Date().getFullYear()} Elom Labs, Nairobi</span>
          <span>Sandbox build — no real funds move.</span>
        </div>
      </footer>
    </div>
  );
}
