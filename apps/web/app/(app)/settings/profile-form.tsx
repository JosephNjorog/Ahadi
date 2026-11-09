"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";

type Values = {
  displayName: string;
  paypalEmail: string;
  country: string;
  phoneE164: string;
  showExactEarnings: boolean;
};

export function ProfileForm({ initial }: { initial: Values }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function validate(): boolean {
    const e: typeof errors = {};
    if (!v.displayName.trim()) e.displayName = "Enter a name.";
    if (v.paypalEmail && !/^\S+@\S+\.\S+$/.test(v.paypalEmail)) e.paypalEmail = "Enter a valid email.";
    if (v.country && !/^[A-Za-z]{2}$/.test(v.country)) e.country = "Use a 2-letter code, e.g. KE.";
    if (v.phoneE164 && !/^\+[1-9]\d{7,14}$/.test(v.phoneE164))
      e.phoneE164 = "Use international format, e.g. +254712345678.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setStatus("saving");
    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus("error");
      setMessage(body?.error?.message ?? "Couldn't save");
      const fe = body?.error?.details as Record<string, string[]> | undefined;
      if (fe)
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, msgs]) => [k, msgs[0]])) as typeof errors);
      return;
    }
    setStatus("saved");
    setMessage(null);
    router.refresh();
  }

  const field = (
    key: Exclude<keyof Values, "showExactEarnings">,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...props}
        value={v[key]}
        onChange={(e) => {
          setV({ ...v, [key]: e.target.value });
          setStatus("idle");
        }}
        aria-invalid={Boolean(errors[key]) || undefined}
        className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-brand-500 aria-[invalid]:border-danger-600"
      />
      {errors[key] ? <span className="mt-1 block text-sm text-danger-600">{errors[key]}</span> : null}
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      {field("displayName", "Display name", { autoComplete: "name", maxLength: 80 })}
      {field("paypalEmail", "PayPal email for payouts", {
        type: "email",
        autoComplete: "email",
        inputMode: "email",
        placeholder: "you@example.com",
      })}
      {field("country", "Country (ISO code)", { maxLength: 2, placeholder: "KE", className: "uppercase" })}
      {field("phoneE164", "WhatsApp number (optional)", {
        type: "tel",
        inputMode: "tel",
        placeholder: "+254712345678",
      })}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.showExactEarnings}
          onChange={(e) => setV({ ...v, showExactEarnings: e.target.checked })}
        />
        Show exact verified earnings on my public passport (otherwise a range)
      </label>
      {status === "error" && message ? (
        <Alert tone="danger" title="Not saved">
          {message}
        </Alert>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={status === "saving"}>
          Save
        </Button>
        {status === "saved" ? <span className="text-sm text-brand-700">Saved</span> : null}
      </div>
    </form>
  );
}
