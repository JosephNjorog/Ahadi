import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb, services } from "@ahadi/db";
import { Alert, Card, CardBody } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { NewPromiseForm } from "./new-promise-form";

export const metadata: Metadata = { title: "New promise" };

export default async function NewPromisePage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  await requireUser("/promises/new");
  const { service: serviceId } = await searchParams;
  const [service] = serviceId ? await getDb().select().from(services).where(eq(services.id, serviceId)) : [];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Start a promise</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Describe the job in plain words. Ahadi's Contract Architect turns it into milestones with checkable
          acceptance criteria, which both of you review and sign before any money is held.
        </p>
      </div>
      {service ? (
        <Alert tone="info" title={`Hiring: ${service.title}`}>
          {formatMoney(service.priceMinor, service.currency)} · delivered within {service.turnaroundHours}h ·
          the provider's template criteria are the starting point.
        </Alert>
      ) : null}
      {!process.env.ANTHROPIC_API_KEY ? (
        <Alert tone="warn" title="AI contract builder is off">
          ANTHROPIC_API_KEY isn't set, so you'll write the criteria by hand after creating the promise.
        </Alert>
      ) : null}
      <Card>
        <CardBody className="py-6">
          <NewPromiseForm
            service={
              service
                ? {
                    id: service.id,
                    category: service.category,
                    priceUsd: service.priceMinor / 100,
                    title: service.title,
                  }
                : null
            }
            voiceEnabled={Boolean(process.env.STT_API_KEY)}
          />
        </CardBody>
      </Card>
    </div>
  );
}
