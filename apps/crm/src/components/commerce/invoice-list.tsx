// Invoices list — server-paginated DataTable (docs/03 §7.6 "auto invoice +
// receipt PDF generation"). Invoices are server-generated async (BullMQ
// invoice-gen queue) — no create/edit affordances here, only list + detail +
// download.
import * as React from "react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, formatPaise, PageHeader, Select, SelectItem } from "@repo/ui";
import type { InvoiceStatus, InvoiceSummary, ListInvoicesQuery } from "@repo/types";

import { useInvoicesList } from "../../hooks/use-invoices";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { InvoiceStatusChip } from "./invoice-status-chip";
import { InvoiceDetailDrawer } from "./invoice-detail-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "void", label: "Void" },
];

export function InvoiceList(): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<InvoiceStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const query: ListInvoicesQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useInvoicesList(query);

  const columns: Array<DataTableColumn<InvoiceSummary>> = [
    { id: "number", header: "Invoice #", cell: (row) => row.number, sortable: true },
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "status", header: "Status", cell: (row) => <InvoiceStatusChip status={row.status} /> },
    {
      id: "issuedAt",
      header: "Issued",
      cell: (row) => (row.issuedAt ? new Date(row.issuedAt).toLocaleDateString() : "Pending"),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="invoices-error"
        title="Couldn't load invoices"
        description={queryErrorMessage(error, "Something went wrong fetching the invoice list.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="invoices-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="invoices-list">
      <PageHeader
        title="Invoices"
        description="Generated automatically on payment success. PDF rendering is a stub in this phase. The row, numbering, and queue are real."
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Invoice number / student name"
        data-testid="invoices-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as InvoiceStatus))}
          wrapperClassName="w-40"
          data-testid="invoices-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedInvoiceId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No invoices yet",
          description: "Invoices are generated automatically when a payment is captured.",
        }}
        caption="Invoices"
        data-testid="invoices-table"
      />

      <InvoiceDetailDrawer invoiceId={selectedInvoiceId} onOpenChange={(open) => !open && setSelectedInvoiceId(null)} />
    </div>
  );
}
