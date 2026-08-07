// Bookings management — DataTable (lead, program, slot via DateChip,
// status, source) + create + status move (docs/03 §7.12). The PUBLIC
// intake (`createPublic`) is not exposed here — that's the website's
// minimal stub funnel (P5); this screen manages the resulting bookings (and
// any staff create directly).
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, DataFilterBar, DataTable, type DataTableColumn, DateChip, EmptyState, PageHeader, Select, SelectItem, useToast } from "@repo/ui";
import type { BookingStatus, BookingSummary, MeResponse } from "@repo/types";

import { useBookingsList, useMoveBookingStatus } from "../../hooks/use-bookings";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { BookingStatusChip } from "./booking-status-chip";
import { BookingFormDrawer } from "./booking-form-drawer";

const STATUS_OPTIONS: { value: BookingStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];

// Valid forward transitions per docs/05 §3 BookingStatus state machine
// (requested → confirmed | cancelled; confirmed → completed | cancelled |
// no_show). Used only to decide which actions to render — the backend is
// the real enforcer and returns 422 on an invalid transition regardless.
const NEXT_STATUSES: Record<BookingStatus, BookingStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

interface BookingListProps {
  me: MeResponse | undefined;
}

export function BookingList({ me }: BookingListProps): React.JSX.Element {
  const canCreate = hasPermission(me?.permissions, "bookings.create");
  const canEdit = hasPermission(me?.permissions, "bookings.edit");

  const [status, setStatus] = React.useState<BookingStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [createOpen, setCreateOpen] = React.useState(false);
  const pageSize = 20;

  const { toast } = useToast();
  const moveStatus = useMoveBookingStatus();

  React.useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading, isError, refetch, isFetching } = useBookingsList({ page, pageSize, status });

  async function handleMove(bookingId: string, nextStatus: BookingStatus) {
    try {
      await moveStatus.mutateAsync({ id: bookingId, body: { status: nextStatus } });
      toast({ title: "Booking status updated", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update booking status");
    }
  }

  const columns: Array<DataTableColumn<BookingSummary>> = [
    { id: "leadName", header: "Lead", cell: (row) => row.leadName ?? "—" },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle ?? "—" },
    {
      id: "slotAt",
      header: "Slot",
      cell: (row) => <DateChip date={new Date(row.slotAt)} format="both" />,
    },
    { id: "status", header: "Status", cell: (row) => <BookingStatusChip status={row.status} /> },
    { id: "source", header: "Source", cell: (row) => row.source },
    {
      id: "actions",
      header: "Move to",
      cell: (row) =>
        canEdit && NEXT_STATUSES[row.status].length > 0 ? (
          <Select
            aria-label={`Move booking for ${row.leadName ?? "this lead"} to status`}
            placeholder="Move to…"
            onValueChange={(value) => handleMove(row.id, value as BookingStatus)}
            data-testid="booking-move-status-select"
          >
            {NEXT_STATUSES[row.status].map((next) => (
              <SelectItem key={next} value={next}>
                {STATUS_OPTIONS.find((opt) => opt.value === next)?.label ?? next}
              </SelectItem>
            ))}
          </Select>
        ) : (
          "—"
        ),
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="bookings-error"
        title="Couldn't load bookings"
        description="Something went wrong fetching bookings."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="bookings-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="booking-list">
      <PageHeader
        title="Bookings"
        description="Demo/slot bookings — manage status from requested through to completed."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} data-testid="bookings-create-button">
              <Plus className="size-4" aria-hidden="true" />
              Add booking
            </Button>
          ) : null
        }
      />

      <DataFilterBar data-testid="bookings-filter-bar">
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as BookingStatus))}
          wrapperClassName="w-44"
          data-testid="bookings-status-filter"
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
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No bookings yet",
          description: "Demo/slot bookings from leads or staff will appear here.",
        }}
        caption="Bookings"
        data-testid="bookings-table"
      />

      <BookingFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
