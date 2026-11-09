"use client";

import { Alert, Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-12">
      <Alert tone="danger" title="Something went wrong" action={<Button size="sm" variant="secondary" onClick={reset}>Try again</Button>}>
        {error.message.includes("PayPal is not configured") || error.message.includes("DATABASE_URL")
          ? error.message
          : "We couldn't load this page. If it keeps happening, check the server logs."}
        {error.digest ? <span className="mt-1 block font-mono text-xs">Ref {error.digest}</span> : null}
      </Alert>
    </div>
  );
}
