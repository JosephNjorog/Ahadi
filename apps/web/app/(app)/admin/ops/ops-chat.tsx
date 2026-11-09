"use client";

import { useState } from "react";
import { Alert, Button, Card, CardBody, Textarea } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { api } from "@/lib/client";

type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; ok: boolean }[] };
const PROMPTS = [
  "Reconcile captures this week against settled milestones.",
  "List authorizations expiring in 48 hours.",
  "Summarize payout failures and likely causes.",
  "Totals for the last 30 days: authorized, captured, voided, paid out and fees.",
];

export function OpsChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    if (!text.trim()) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ text: string; toolCalls: { name: string; ok: boolean }[] }>(
        "/api/admin/ops-agent",
        { body: { messages: next.map(({ role, content }) => ({ role, content })) } },
      );
      setMsgs([...next, { role: "assistant", content: r.text || "(no answer)", tools: r.toolCalls }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {msgs.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void send(p)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-sm hover:bg-canvas"
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-3">
        {msgs.map((m, i) => (
          <Card key={i} className={cn(m.role === "user" && "bg-brand-50")}>
            <CardBody>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                {m.role === "user" ? "You" : "Ops Agent"}
              </p>
              <div className="mt-1 whitespace-pre-wrap text-sm">{m.content}</div>
              {m.tools?.length ? (
                <p className="mt-2 text-xs text-ink-subtle">
                  Looked up: {m.tools.map((t) => `${t.name}${t.ok ? "" : " (failed)"}`).join(", ")}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </div>
      {error ? (
        <Alert tone="danger" title="The Ops Agent failed">
          {error}
        </Alert>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about money flows, holds, payouts…"
        />
        <Button type="submit" loading={busy} disabled={!input.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
