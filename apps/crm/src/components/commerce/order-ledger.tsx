// Orders ledger — server-paginated DataTable wired to hooks/use-orders.ts
// (docs/03 §7.6, §10 Commerce ▸ Payments). Filters: status/student/program/
// date-range. Row → detail drawer (student, program, amount, discount,
// coupon, status, linked payment(s)/enrollment/invoice). RBAC-aware: this
// view requires `orders.view` (gated by the route/nav already); no
// create/edit affordances — orders are created by the order/checkout flow,
// not the CRM directly (P5 web funnel + P2 manual payment path).
import * as React from "react";
import { formatPaise, DataFilterBar, DataTable, type DataTableColumn, EmptyState, Button, Input, PageHeader, Select, SelectItem } from "@repo/ui";
import type { ListOrdersQuery, OrderStatus, OrderSummary, MeResponse } from "@repo/types";

import { useOrdersList } from "../../hooks/use-orders";
import { useProgramsList } from "../../hooks/use-courses";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { OrderStatusChip } from "./order-status-chip";
import { OrderDetailDrawer } from "./order-detail-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

interface OrderLedgerProps {
  me: MeResponse | undefined;
}

export function OrderLedger({ me: _me }: OrderLedgerProps): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<OrderStatus | undefined>(undefined);
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selectedOrderId, setSelectedOrderId] = React.useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, programId, from, to]);

  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });

  const query: ListOrdersQuery = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
    programId,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useOrdersList(query);

  const columns: Array<DataTableColumn<OrderSummary>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName, sortable: true },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName },
    {
      id: "amountPaise",
      header: "Amount",
      cell: (row) => formatPaise(row.amountPaise),
      align: "right",
    },
    {
      id: "discountPaise",
      header: "Discount",
      cell: (row) => (row.discountPaise > 0 ? formatPaise(row.discountPaise) : "-"),
      align: "right",
    },
    { id: "couponCode", header: "Coupon", cell: (row) => row.couponCode ?? "-" },
    {
      id: "status",
      header: "Status",
      cell: (row) => <OrderStatusChip status={row.status} />,
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="orders-error"
        title="Couldn't load the order ledger"
        description={queryErrorMessage(error, "Something went wrong fetching orders.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="orders-retry">
            Try again
          </Button>
        }
      />
    );
  }

  const programs = programsData?.items ?? [];

  return (
    <div className="space-y-4 md:space-y-5" data-testid="orders-ledger">
      <PageHeader
        title="Orders"
        description="The order ledger. Every program purchase, its coupon, and its enrollment link."
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Student name / email / order id"
        data-testid="orders-filter-bar"
      >
        <Select
          label="Program"
          placeholder="All programs"
          value={programId}
          onValueChange={(value) => setProgramId(value === "__all__" ? undefined : value)}
          wrapperClassName="w-48"
          data-testid="orders-program-filter"
        >
          <SelectItem value="__all__">All programs</SelectItem>
          {programs.map((program) => (
            <SelectItem key={program.id} value={program.id}>
              {program.title}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as OrderStatus))}
          wrapperClassName="w-40"
          data-testid="orders-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          wrapperClassName="w-40"
          data-testid="orders-from-filter"
        />
        <Input
          label="To"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          wrapperClassName="w-40"
          data-testid="orders-to-filter"
        />
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedOrderId(row.id)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No orders yet",
          description: "Try adjusting your filters. Orders are created by the checkout/admissions flow.",
        }}
        caption="Order ledger"
        data-testid="orders-table"
      />

      <OrderDetailDrawer orderId={selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)} />
    </div>
  );
}
