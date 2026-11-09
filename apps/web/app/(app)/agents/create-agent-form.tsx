"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client";
import { KeyReveal } from "./key-reveal";

export function CreateAgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"buyer" | "provider" | "both">("buyer");
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; key: string } | null>(null);

  if (created) return <KeyReveal apiKey={created.key} agentId={created.id} />;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError("Give the agent a name");
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ agent: { id: string }; apiKey: string }>("/api/agents", {
            body: { name, kind, providerWebhookUrl: kind !== "buyer" ? webhook : undefined },
          });
          setCreated({ id: r.agent.id, key: r.apiKey });
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My research assistant"
          maxLength={60}
        />
      </Field>
      <Field label="Role" hint="Buyers hire and pay; providers deliver work and get paid.">
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="buyer">Buyer (hires work)</option>
          <option value="provider">Provider (sells work)</option>
          <option value="both">Both</option>
        </Select>
      </Field>
      {kind !== "buyer" ? (
        <Field
          label="Webhook URL (optional)"
          hint="Ahadi POSTs job.funded / job.verdict / job.paid events here, signed with X-Ahadi-Signature."
        >
          <Input
            type="url"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://my-agent.example.com/ahadi"
          />
        </Field>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Not created">
          {error}
        </Alert>
      ) : null}
      <Button type="submit" loading={busy}>
        Create agent and key
      </Button>
    </form>
  );
}
