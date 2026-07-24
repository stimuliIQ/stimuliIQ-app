// Student 360 — Enrollments tab (Phase 9 Completion T37; lifecycle-redesign P2).
// Real enrollments via the P1 enrollments endpoint, PLUS the student's OPEN
// orders shown as "awaiting payment" program assignments — an unpaid order
// carries the program+batch context (the stepper's "Program ✓ / Payment …"
// state) but has no enrollment row yet, and hiding it here made the tab read
// as empty while the header said Payment Pending. An "Add program" action
// opens another order for this student (orders.create-gated).
import * as React from "react";
import { Button, DataTable, type DataTableColumn, EmptyState, StatusChip, formatPaise } from "@repo/ui";
import type { Enrollment, EnrollmentStatus, MeResponse, OrderSummary } from "@repo/types";

import { useEnrollmentsList } from "../../hooks/use-enrollments";
import { useOrdersList } from "../../hooks/use-orders";
import { hasPermission } from "../../lib/permissions";
import { AddProgramDialog } from "./add-program-dialog";

const STATUS_TONE: Record<EnrollmentStatus, "success" | "info" | "danger"> = {
  active: "success",
  completed: "info",
  dropped: "danger",
};

export function StudentEnrollmentsTab({
  studentId,
  me,
}: {
  studentId: string;
  me: MeResponse | undefined;
}): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useEnrollmentsList({ studentId, page: 1, pageSize: 20 });
  // Open (unpaid) orders = program assignments awaiting payment.
  const orders = useOrdersList({ studentId, status: "created", page: 1, pageSize: 20 });
  const pendingOrders = orders.data?.items ?? [];

  const canAddProgram = hasPermission(me?.permissions, "orders.create");
  const [addOpen, setAddOpen] = React.useState(false);

  const columns: Array<DataTableColumn<Enrollment>> = [
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} /> },
    { id: "progressPct", header: "Progress", cell: (row) => `${row.progressPct}%`, align: "right" },
    { id: "enrolledAt", header: "Enrolled", cell: (row) => new Date(row.enrolledAt).toLocaleDateString(), align: "right" },
  ];

  const pendingColumns: Array<DataTableColumn<OrderSummary>> = [
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName },
    {
      id: "status",
      header: "Status",
      cell: () => <StatusChip tone="warning" label="Awaiting payment" />,
    },
    { id: "amountPaise", header: "Amount", cell: (row) => formatPaise(row.amountPaise), align: "right" },
    { id: "createdAt", header: "Ordered", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="student-enrollments-error"
        title="Couldn't load enrollments"
        description="Something went wrong fetching this student's enrollments."
        action={
          <button type="button" onClick={() => refetch()} className="text-sm font-medium text-brand-500 hover:underline">
            Try again
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canAddProgram ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)} data-testid="student-add-program-button">
            Add program
          </Button>
        </div>
      ) : null}

      {pendingOrders.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="student-pending-orders">
          <h4 className="text-sm font-medium text-fg">Awaiting payment</h4>
          <p className="text-xs text-fg-muted">
            Program assigned via an open order — the enrollment activates when its payment is recorded (see the
            Payments tab).
          </p>
          <DataTable
            columns={pendingColumns}
            rows={pendingOrders}
            getRowId={(row) => row.id}
            caption="Programs awaiting payment"
            data-testid="student-pending-orders-table"
          />
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        caption="Student enrollments"
        emptyState={
          pendingOrders.length > 0
            ? {
                title: "No active enrollments yet",
                description: "The assigned program above activates once its payment is recorded.",
              }
            : { title: "No enrollments", description: "This student isn't enrolled in any batch yet." }
        }
        data-testid="student-enrollments-table"
      />

      <AddProgramDialog studentId={studentId} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
