"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";

export function SignInForm({
  next,
  demoMode,
  initialError,
}: {
  next: string;
  demoMode: boolean;
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setStatus("sending");
    const res = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus("idle");
      setError(body?.error?.message ?? "Couldn't send the link. Try again.");
      return;
    }
    setDevLink(body.devLink ?? null);
    setStatus("sent");
  }

  async function demo(role: string) {
    setDemoLoading(role);
    setError(null);
    const res = await fetch("/api/auth/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setDemoLoading(null);
      setError((await res.json().catch(() => null))?.error?.message ?? "Demo sign-in failed");
      return;
    }
    window.location.href = role === "admin" ? "/admin" : next;
  }

  if (status === "sent") {
    return (
      <div className="mt-5 space-y-3">
        <Alert tone="brand" title="Check your email">
          We sent a sign-in link to <strong className="text-ink">{email}</strong>. It works once and expires
          in 15 minutes.
        </Alert>
        {devLink ? (
          <Alert tone="warn" title="Development: email isn't configured">
            <a className="break-all font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={devLink}>
              Open the sign-in link
            </a>
          </Alert>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setStatus("idle")}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-ink"
            placeholder="you@example.com"
            aria-invalid={Boolean(error) || undefined}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" size="lg" loading={status === "sending"}>
          Email me a sign-in link
        </Button>
      </form>

      {demoMode ? (
        <div className="border-t border-line pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Demo accounts</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {["client", "worker", "admin"].map((r) => (
              <Button
                key={r}
                variant="secondary"
                size="sm"
                loading={demoLoading === r}
                disabled={Boolean(demoLoading)}
                onClick={() => void demo(r)}
                className="capitalize"
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
