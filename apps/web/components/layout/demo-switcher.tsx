"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const ROLES = [
  { role: "client", label: "Client" },
  { role: "worker", label: "Worker" },
  { role: "admin", label: "Admin" },
] as const;

/** One-click identity switch for demos (only rendered when DEMO_MODE=true). */
export function DemoSwitcher({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = ROLES.find((r) => currentEmail.startsWith(r.role))?.role ?? "";

  async function switchTo(role: string) {
    setError(null);
    const res = await fetch("/api/auth/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error?.message ?? "Switch failed");
      return;
    }
    start(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="hidden sm:inline">Demo as</span>
      <select
        className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink"
        value={current}
        disabled={pending}
        onChange={(e) => void switchTo(e.target.value)}
        aria-label="Switch demo identity"
        title={error ?? undefined}
      >
        {current === "" ? <option value="">Choose…</option> : null}
        {ROLES.map((r) => (
          <option key={r.role} value={r.role}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}
