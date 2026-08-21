// Coupons list — CRUD (Marketing-owned per docs/03 §9 + phase-2.md §"Risks
// #8"; Finance/Owner/Admin view). DataTable + create/edit form drawer +
// soft-delete via status=inactive + a validate-coupon mini-tool.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  DateChip,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import type { CouponStatus, CouponSummary, CouponType, ListCouponsQuery, MeResponse } from "@repo/types";

import { useCouponsList, useDeleteCoupon } from "../../hooks/use-coupons";
import { getModulePermissions } from "../../lib/permissions";
import { CouponStatusChip } from "./coupon-status-chip";
import { CouponFormDrawer } from "./coupon-form-drawer";
import { ValidateCouponTool } from "./validate-coupon-tool";

const STATUS_OPTIONS: { value: CouponStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "expired", label: "Expired" },
];

const TYPE_OPTIONS: { value: CouponType; label: string }[] = [
  { value: "pct", label: "Percentage" },
  { value: "flat", label: "Flat" },
];

function formatCouponValue(coupon: CouponSummary): string {
  return coupon.type === "pct" ? `${coupon.value}%` : `₹${(coupon.value / 100).toFixed(2)}`;
}

interface CouponListProps {
  me: MeResponse | undefined;
}

export function CouponList({ me }: CouponListProps): React.JSX.Element {
  const permissions = getModulePermissions(me, "coupons");
  const { toast } = useToast();

  const [status, setStatus] = React.useState<CouponStatus | undefined>(undefined);
  const [type, setType] = React.useState<CouponType | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editCoupon, setEditCoupon] = React.useState<CouponSummary | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [status, type]);

  const query: ListCouponsQuery = { page, pageSize, status, type };
  const { data, isLoading, isError, refetch, isFetching } = useCouponsList(query);
  const deleteCoupon = useDeleteCoupon();

  function handleDelete() {
    if (!deleteId) return;
    deleteCoupon.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Coupon deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete coupon", description: (err as Error).message, variant: "destructive" });
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<CouponSummary>> = [
    { id: "code", header: "Code", cell: (row) => row.code, sortable: true },
    { id: "type", header: "Type", cell: (row) => (row.type === "pct" ? "Percentage" : "Flat") },
    { id: "value", header: "Value", cell: (row) => formatCouponValue(row), align: "right" },
    {
      id: "used",
      header: "Used / Max",
      cell: (row) => `${row.used}${row.maxUses ? ` / ${row.maxUses}` : ""}`,
      align: "right",
    },
    {
      id: "validity",
      header: "Validity",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          {row.validFrom ? <DateChip date={new Date(row.validFrom)} format="absolute" /> : null}
          {row.validFrom && row.validTo ? <span className="text-fg-subtle">–</span> : null}
          {row.validTo ? <DateChip date={new Date(row.validTo)} format="absolute" /> : null}
          {!row.validFrom && !row.validTo ? <span className="text-fg-subtle">No expiry</span> : null}
        </div>
      ),
    },
    { id: "status", header: "Status", cell: (row) => <CouponStatusChip status={row.status} /> },
    ...(permissions.canDelete
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: (row: CouponSummary) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteId(row.id);
                }}
                aria-label={`Delete coupon ${row.code}`}
                data-testid={`delete-coupon-${row.id}`}
              >
                <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
              </Button>
            ),
          } satisfies DataTableColumn<CouponSummary>,
        ]
      : []),
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="coupons-error"
        title="Couldn't load coupons"
        description="Something went wrong fetching the coupon list."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="coupons-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="coupons-list">
      <PageHeader
        title="Coupons"
        description="Discount codes. Percentage or flat, with usage caps and validity windows."
        actions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="coupons-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add coupon
            </Button>
          ) : null
        }
      />

      <ValidateCouponTool />

      <DataFilterBar data-testid="coupons-filter-bar">
        <Select
          label="Type"
          placeholder="All types"
          value={type}
          onValueChange={(value) => setType(value === "__all__" ? undefined : (value as CouponType))}
          wrapperClassName="w-40"
          data-testid="coupons-type-filter"
        >
          <SelectItem value="__all__">All types</SelectItem>
          {TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as CouponStatus))}
          wrapperClassName="w-40"
          data-testid="coupons-status-filter"
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
        onRowClick={permissions.canEdit ? (row) => setEditCoupon(row) : undefined}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No coupons yet",
          description: "Add the first discount code.",
        }}
        caption="Coupons"
        data-testid="coupons-table"
      />

      <CouponFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
      {editCoupon ? (
        <CouponFormDrawer
          open={Boolean(editCoupon)}
          onOpenChange={(open) => !open && setEditCoupon(null)}
          couponId={editCoupon.id}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this coupon?"
        description="It will be soft-deleted. Orders that already used it are unaffected."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteCoupon.isPending}
        data-testid="confirm-delete-coupon"
      />
    </div>
  );
}
