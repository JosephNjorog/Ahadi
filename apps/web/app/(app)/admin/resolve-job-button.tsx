"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function ResolveJobButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        await fetch(`/api/admin/job-failures/${id}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      Mark resolved
    </Button>
  );
}
