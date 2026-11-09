import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { OpsChat } from "./ops-chat";

export const metadata: Metadata = { title: "Ops Agent" };

export default async function OpsPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
        ← Admin
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ops Agent</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Reconciliation and reporting over Ahadi's data and PayPal (read-only). It cannot capture, void,
          refund or pay out.
        </p>
      </div>
      {!process.env.ANTHROPIC_API_KEY ? <Alert tone="warn" title="Needs ANTHROPIC_API_KEY" /> : null}
      <OpsChat />
    </div>
  );
}
