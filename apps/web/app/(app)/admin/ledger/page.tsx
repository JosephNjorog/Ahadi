import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { LedgerGrid } from "./ledger-grid";

export const metadata: Metadata = { title: "Admin ledger" };

export default async function AdminLedgerPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
        ← Admin
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ledger grid</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Promises × milestones × fundings × settlements × payouts. Filter, sort, group by any column, and
          export CSV.
        </p>
      </div>
      <LedgerGrid />
    </div>
  );
}
