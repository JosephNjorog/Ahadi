"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";

export function VerifyChainButton({ promiseId }: { promiseId: string }) {
  const [state, setState] = useState<{ k: "idle" } | { k: "busy" } | { k: "done"; valid: boolean; detail: string } | { k: "error" }>({ k: "idle" });
  return (
    <div className="flex items-center gap-2">
      {state.k === "done" ? <Badge tone={state.valid ? "brand" : "danger"}>{state.detail}</Badge> : null}
      {state.k === "error" ? <Badge tone="danger">Couldn't verify</Badge> : null}
      <Button
        variant="secondary"
        size="sm"
        loading={state.k === "busy"}
        onClick={async () => {
          setState({ k: "busy" });
          const res = await fetch(`/api/promises/${promiseId}/ledger/verify`);
          if (!res.ok) return setState({ k: "error" });
          const v = await res.json();
          setState({ k: "done", valid: v.valid, detail: v.valid ? `Verified ${v.length} events` : `Broken at #${v.brokenAt}` });
        }}
      >
        Verify chain
      </Button>
    </div>
  );
}
