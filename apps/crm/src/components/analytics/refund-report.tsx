// Refund report — aggregates the existing refunds ledger (real backend
// list, `client.commerce.refunds.list`) by status + total refunded amount
// for a date range. No dedicated `crm/reports/refunds` endpoint exists —
// this is a real list with client-side aggregation, not a fabricated
// number. Phase 9 Completion T40.
import * as React from "react";
import { Button, DataTable, type DataTableColumn, KpiCard, formatPaise } from "@repo/ui";
import type { MeResponse, RefundSummary } from "@repo/types";
import { Receipt } from "lucide-react";

import { useRefundsList } from "../../hooks/use-refunds";
import { hasPermission } from "../../lib/permissions";
import { defaultDateRange } from "../../lib/report-dates";
import { buildCsv, downloadCsv } from "../../lib/csv-export";
import { queryErrorMessage } from "../../lib/surface-error";
import { DateRangeFilter } from "./date-range-filter";
import { ReportErrorState } from "./report-error-state";
import { ReportPageShell } from "./report-page-shell";
import { RefundStatusChip } from "../commerce/refund-status-chip";

export function RefundReport({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canView = hasPermission(me?.permissions, "refunds.view");
  const [range, setRange] = React.useState(defaultDateRange(30));

  const { data, isLoading, isError, error, refetch } = useRefundsList({
    page: 1,
    pageSize: 200,
    from: `${range.from}T00:00:00.000Z`,
    to: `${range.to}T23:59:59.999Z`,
  });

  const rows = data?.items ?? [];
  const totalPaise = rows.filter((r) => r.status === "processed").reduce((sum, r) => sum + r.amountPaise, 0);
  const approvedCount = rows.filter((r) => r.status === "processed" || r.status === "approved").length;

  const columns: Array<DataTableColumn<RefundSummary>> = [
    { id: "orderId", header: "Order", cell: (row) => row.orderId },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "reason", header: "Reason", cell: (row) => row.reason },
    { id: "status", header: "Status", cell: (row) => <RefundStatusChip status={row.status} /> },
    { id: "createdAt", header: "Requested", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
  ];

  function exportCsv() {
    const csv = buildCsv(
      rows.map((r) => ({ order: r.orderId, amountPaise: r.amountPaise, reason: r.reason, status: r.status, createdAt: r.createdAt })),
      [
        { key: "order", header: "Order" },
        { key: "amountPaise", header: "Amount (paise)" },
        { key: "reason", header: "Reason" },
        { key: "status", header: "Status" },
        { key: "createdAt", header: "Requested at" },
      ],
    );
    downloadCsv(`refunds-${range.from}-to-${range.to}.csv`, csv);
  }

  return (
    <ReportPageShell title="Refund Report" description="Refund volume and reasons for the selected range." canView={canView} data-testid="refund-report">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter from={range.from} to={range.to} onFromChange={(from) => setRange((r) => ({ ...r, from }))} onToChange={(to) => setRange((r) => ({ ...r, to }))} />
        <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0} data-testid="refund-report-export">
          Export CSV
        </Button>
      </div>

      {isError ? (
        <ReportErrorState
          message={queryErrorMessage(error, "Couldn't load the refund report.")}
          onRetry={() => void refetch()}
          data-testid="refund-report-error"
        />
      ) : (
        <>
          <p className="text-xs text-fg-muted" data-testid="refund-report-freshness-note">
            Computed live from the refunds ledger, no cached snapshot.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label="Total refunded" value={formatPaise(totalPaise)} icon={<Receipt />} loading={isLoading} data-testid="refund-total-kpi" />
            <KpiCard label="Approved/processed count" value={approvedCount} loading={isLoading} data-testid="refund-approved-kpi" />
            <KpiCard label="Total requests" value={rows.length} loading={isLoading} data-testid="refund-count-kpi" />
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            loading={isLoading}
            caption="Refunds"
            emptyState={{ title: "No refunds in this range" }}
            data-testid="refund-report-table"
          />
        </>
      )}
    </ReportPageShell>
  );
}
