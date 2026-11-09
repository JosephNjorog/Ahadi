"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/client";

export function ResolveRiskButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      onClick={async () => {
        const note = window.prompt("Resolution note (written to the ledger):");
        if (!note || note.trim().length < 3) return;
        setBusy(true);
        try {
          await api(`/api/admin/risk/${id}`, { body: { note } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Resolve
    </Button>
  );
}
