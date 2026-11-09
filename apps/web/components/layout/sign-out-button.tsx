"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        await fetch("/api/auth/sign-out", { method: "POST" });
        window.location.href = "/";
      }}
    >
      Sign out
    </Button>
  );
}
