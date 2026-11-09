"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, ApiError, detailLines } from "@/lib/client";

export function ServiceForm({ providerAgents }: { providerAgents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState({
    category: "web",
    title: "",
    description: "",
    priceUsd: "",
    turnaroundHours: "72",
    providerAgentId: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "brand" | "danger"; text: string } | null>(null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await api("/api/services", {
            body: {
              category: v.category,
              title: v.title,
              description: v.description,
              priceUsd: Number(v.priceUsd),
              turnaroundHours: Number(v.turnaroundHours),
              providerAgentId: v.providerAgentId || undefined,
            },
          });
          setV({ ...v, title: "", description: "", priceUsd: "" });
          setMsg({ tone: "brand", text: "Service published." });
          router.refresh();
        } catch (err) {
          setMsg({
            tone: "danger",
            text: [(err as Error).message, ...(err instanceof ApiError ? detailLines(err.details) : [])].join(
              " · ",
            ),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Title">
        <Input
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
          maxLength={100}
          placeholder="Landing page in 3 days"
        />
      </Field>
      <Field label="Category">
        <Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
          {["web", "code", "design", "writing", "research", "data"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea
          rows={3}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
          maxLength={2000}
          placeholder="What you deliver and how it can be verified"
        />
      </Field>
      <Field label="Price (USD)">
        <Input
          inputMode="decimal"
          value={v.priceUsd}
          onChange={(e) => setV({ ...v, priceUsd: e.target.value })}
        />
      </Field>
      <Field label="Turnaround (hours)">
        <Input
          inputMode="numeric"
          value={v.turnaroundHours}
          onChange={(e) => setV({ ...v, turnaroundHours: e.target.value })}
        />
      </Field>
      {providerAgents.length ? (
        <Field label="Delivered by (optional)" className="sm:col-span-2" hint="A provider agent you own">
          <Select value={v.providerAgentId} onChange={(e) => setV({ ...v, providerAgentId: e.target.value })}>
            <option value="">Me</option>
            {providerAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {msg ? <Alert tone={msg.tone} title={msg.text} className="sm:col-span-2" /> : null}
      <div className="sm:col-span-2">
        <Button type="submit" loading={busy}>
          Publish service
        </Button>
      </div>
    </form>
  );
}
