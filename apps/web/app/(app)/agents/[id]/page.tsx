import type { Metadata } from "next";
import Link from "next/link";
import { getAgentDetail } from "@ahadi/services";
import { Badge, Card, CardBody, CardHeader, Stat } from "@/components/ui";
import { actorFor, requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { orNotFound } from "@/lib/page";
import { AgentActions, MandateForm } from "./agent-forms";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/agents/${id}`);
  const { agent, mandate, spend, actions } = await orNotFound(() => getAgentDetail(actorFor(user), id));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/agents" className="text-sm text-ink-muted hover:text-ink">
        ← Agents
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Badge>{agent.kind}</Badge> <span className="font-mono">{agent.apiKeyPrefix}…</span>{" "}
            {agent.revokedAt ? <Badge tone="danger">revoked {formatDateTime(agent.revokedAt)}</Badge> : null}
          </p>
        </div>
        {!agent.revokedAt ? <AgentActions agentId={agent.id} /> : null}
      </div>
      {mandate ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Spent this month"
            value={formatMoney(spend)}
            hint={`of ${formatMoney(mandate.monthlyMaxMinor)}`}
          />
          <Stat label="Per-job limit" value={formatMoney(mandate.perJobMaxMinor)} />
          <Stat label="Min provider score" value={mandate.minProviderScore.toFixed(2)} />
        </div>
      ) : null}
      {agent.kind !== "provider" ? (
        <Card>
          <CardHeader
            title="Spending mandate"
            description="Checked before every create_promise and fund_promise. Your owner approval in PayPal is still required to secure funds."
          />
          <CardBody>
            <MandateForm
              agentId={agent.id}
              initial={
                mandate
                  ? {
                      perJobMaxUsd: mandate.perJobMaxMinor / 100,
                      monthlyMaxUsd: mandate.monthlyMaxMinor / 100,
                      allowedCategories: mandate.allowedCategories,
                      minProviderScore: mandate.minProviderScore,
                      requireOwnerApprovalAboveUsd: mandate.requireOwnerApprovalAboveMinor
                        ? mandate.requireOwnerApprovalAboveMinor / 100
                        : null,
                      active: mandate.active,
                    }
                  : null
              }
            />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Recent actions" description="Every MCP tool call and webhook delivery" />
        {actions.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-muted">No activity yet.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {actions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span>
                  <span className="font-mono">{a.tool}</span>{" "}
                  <Badge tone={a.result === "ok" ? "brand" : "danger"}>{a.result}</Badge>
                  {a.result === "error" && a.detail ? (
                    <span className="ml-2 text-xs text-danger-600">
                      {String((a.detail as { message?: string }).message ?? "")}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-subtle">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
