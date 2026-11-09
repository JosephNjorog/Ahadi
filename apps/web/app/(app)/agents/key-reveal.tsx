"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";

export function KeyReveal({ apiKey, agentId }: { apiKey: string; agentId?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const config = JSON.stringify(
    {
      mcpServers: {
        ahadi: { type: "http", url: `${origin}/mcp`, headers: { Authorization: `Bearer ${apiKey}` } },
      },
    },
    null,
    2,
  );
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(what);
  };
  return (
    <div className="space-y-3">
      <Alert tone="warn" title="Copy this key now — it won't be shown again">
        <code className="mt-1 block break-all rounded bg-surface px-2 py-1 font-mono text-xs text-ink">
          {apiKey}
        </code>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy(apiKey, "key")}>
          {copied === "key" ? "Copied" : "Copy key"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void copy(config, "config")}>
          {copied === "config" ? "Copied" : "Copy MCP config"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-canvas p-3 text-xs">{config}</pre>
      {agentId ? (
        <Link
          href={`/agents/${agentId}`}
          className="text-sm font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
        >
          Set its spending mandate →
        </Link>
      ) : null}
    </div>
  );
}
