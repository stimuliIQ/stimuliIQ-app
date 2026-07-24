// Commerce > Plans — EMI plan list + create + installment schedule/dunning.
// Phase 9 Completion T24/T39.
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, Select, SelectItem, StatusChip, formatPaise } from "@repo/ui";
import type { EmiPlanStatus, EmiPlanSummary, MeResponse } from "@repo/types";

import { useEmiPlansList } from "../../hooks/use-emi-plans";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { EmiPlanFormDrawer } from "./emi-plan-form-drawer";
import { EmiPlanDetailDrawer } from "./emi-plan-detail-drawer";

const STATUS_OPTIONS: EmiPlanStatus[] = ["active", "completed", "defaulted", "cancelled"];

export function EmiPlanDirectory({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  // apps/api/src/modules/emi/emi.controller.ts: view/create/edit/charge.
  const canCreate = hasPermission(me?.permissions, "emi.create");
  const canCharge = hasPermission(me?.permissions, "emi.charge");
  const canEdit = hasPermission(me?.permissions, "emi.edit");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<EmiPlanStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const pageSize = 20;

  const debouncedSearch = useDebouncedValue(search);
  React.useEffect(() => setPage(1), [debouncedSearch, status]);

  const { data, isLoading, isFetching, isError, refetch } = useEmiPlansList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
  });

  const columns: Array<DataTableColumn<EmiPlanSummary>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    { id: "totalAmountPaise", header: "Total", cell: (row) => formatPaise(row.totalAmountPaise) },
    { id: "numInstallments", header: "Installments", cell: (row) => row.numInstallments, align: "right" },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusChip tone={row.status === "active" ? "info" : row.status === "completed" ? "success" : "danger"} label={row.status} size="sm" />
      ),
    },
    { id: "startDate", header: "Start", cell: (row) => new Date(row.startDate).toLocaleDateString(), align: "right" },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load EMI plans"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="emi-plans-error"
      />
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="emi-plan-directory">
      <PageHeader
        title="Plans"
        description="EMI installment plans and dunning for part-paid orders."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="emi-plan-create-button">
              <Plus className="size-4" aria-hidden="true" />
              New plan
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Student name / order id"
        data-testid="emi-plan-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(v) => setStatus(v === "__all__" ? undefined : (v as EmiPlanStatus))}
          wrapperClassName="w-40"
          data-testid="emi-plan-status-filter"
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedId(row.id)}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{ title: "No EMI plans yet", description: "Create a plan against a paid order to get started." }}
        caption="EMI plans"
        data-testid="emi-plan-table"
      />

      <EmiPlanFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <EmiPlanDetailDrawer planId={selectedId} onOpenChange={(open) => !open && setSelectedId(null)} canCharge={canCharge} canEdit={canEdit} />
    </div>
  );
}
