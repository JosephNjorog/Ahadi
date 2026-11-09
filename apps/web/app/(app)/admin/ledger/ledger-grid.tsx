"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import { api } from "@/lib/client";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = Record<string, unknown>;
const money = (p: ValueFormatterParams) =>
  p.value == null
    ? ""
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: String(p.data?.currency ?? "USD"),
      }).format(Number(p.value) / 100);
const date = (p: ValueFormatterParams) =>
  p.value ? new Date(String(p.value)).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }) : "";

/** AG Grid admin ledger (SPEC §20 Admin). */
export function LedgerGrid() {
  const grid = useRef<AgGridReact<Row>>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  useEffect(() => {
    api<{ rows: Row[] }>("/api/admin/grid")
      .then((r) => setRows(r.rows))
      .catch((e) => setError((e as Error).message));
  }, []);

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: "promise",
        headerName: "Promise",
        pinned: "left",
        minWidth: 220,
        cellRenderer: (p: { value: string; data: Row }) => (
          <a href={`/promises/${String(p.data.promise_id)}`} className="text-brand-700 underline">
            {p.value}
          </a>
        ),
      },
      { field: "category", width: 110 },
      { field: "promise_state", headerName: "Promise state", width: 140 },
      { field: "position", headerName: "M#", width: 70 },
      { field: "milestone", minWidth: 180 },
      { field: "milestone_state", headerName: "Milestone state", width: 160 },
      {
        field: "amount_minor",
        headerName: "Amount",
        valueFormatter: money,
        type: "numericColumn",
        width: 120,
      },
      { field: "client", width: 160 },
      { field: "worker", width: 160 },
      { field: "funding_status", headerName: "Funding", width: 130 },
      { field: "paypal_order_id", headerName: "PayPal order", width: 190 },
      { field: "paypal_authorization_id", headerName: "Authorization", width: 190 },
      { field: "expires_at", headerName: "Hold expires", valueFormatter: date, width: 170 },
      {
        field: "release_bps",
        headerName: "Release %",
        valueFormatter: (p) => (p.value == null ? "" : `${Number(p.value) / 100}%`),
        width: 110,
      },
      {
        field: "capture_minor",
        headerName: "Proposed capture",
        valueFormatter: money,
        type: "numericColumn",
        width: 150,
      },
      { field: "settlement_status", headerName: "Settlement", width: 130 },
      { field: "paypal_capture_id", headerName: "Capture", width: 190 },
      {
        field: "captured_minor",
        headerName: "Captured",
        valueFormatter: money,
        type: "numericColumn",
        width: 120,
      },
      {
        field: "paypal_fee_minor",
        headerName: "PayPal fee",
        valueFormatter: money,
        type: "numericColumn",
        width: 120,
      },
      {
        field: "paid_out_minor",
        headerName: "Paid out",
        valueFormatter: money,
        type: "numericColumn",
        width: 120,
      },
      { field: "updated_at", headerName: "Updated", valueFormatter: date, width: 170, sort: "desc" },
    ],
    [],
  );

  if (error)
    return (
      <Alert tone="danger" title="Couldn't load the ledger">
        {error}
      </Alert>
    );
  if (!rows)
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-ink-muted">
        <Spinner className="size-4" /> Loading…
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Quick filter (ids, names, states)"
          className="max-w-sm"
          aria-label="Quick filter"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            grid.current?.api.exportDataAsCsv({
              fileName: `ahadi-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
            })
          }
        >
          Export CSV
        </Button>
        <span className="text-xs text-ink-subtle">{rows.length} rows</span>
      </div>
      <div style={{ height: "70vh" }}>
        <AgGridReact<Row>
          ref={grid}
          theme={
            dark
              ? themeQuartz.withParams({
                  backgroundColor: "#111d19",
                  foregroundColor: "#e7efec",
                  headerBackgroundColor: "#0b1411",
                  borderColor: "#22322d",
                })
              : themeQuartz
          }
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, filter: true, resizable: true, enableRowGroup: true }}
          quickFilterText={quick}
          pagination
          paginationPageSize={50}
          animateRows
        />
      </div>
    </div>
  );
}
