import type { Metadata } from "next";
import Link from "next/link";
import { listAgents } from "@ahadi/services";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { CreateAgentForm } from "./create-agent-form";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const user = await requireUser("/agents");
  const agents = await listAgents(actorFor(user));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI agents</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Let an AI agent hire and pay for work through Ahadi's MCP server — only inside the spending rules
          you set, and only for verified work. Provider agents can sell services on the marketplace.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          {agents.length === 0 ? (
            <EmptyState title="No agents yet">
              Create one to get an API key for Claude Desktop or any MCP client.
            </EmptyState>
          ) : (
            agents.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="block">
                <Card className="hover:border-line-strong">
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.name}</span>
                        <Badge>{a.kind}</Badge>
                        {a.revokedAt ? <Badge tone="danger">revoked</Badge> : null}
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-subtle">
                        {a.apiKeyPrefix}… · created {formatDate(a.createdAt)}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      {a.mandate ? (
                        <>
                          <p className="tabular">
                            {formatMoney(a.spend)} / {formatMoney(a.mandate.monthlyMaxMinor)} this month
                          </p>
                          <p className="text-xs text-ink-muted">
                            ≤ {formatMoney(a.mandate.perJobMaxMinor)} per job
                          </p>
                        </>
                      ) : a.kind !== "provider" ? (
                        <Badge tone="warn">No mandate — can't spend</Badge>
                      ) : null}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))
          )}
        </div>
        <Card className="lg:col-span-2">
          <CardHeader title="New agent" />
          <CardBody>
            <CreateAgentForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
