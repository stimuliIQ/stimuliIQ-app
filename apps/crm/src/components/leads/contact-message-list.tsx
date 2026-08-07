// Contact messages — inbound submissions from the marketing site's "Contact
// Us" form (POST /public/contact → contact_submissions). Staff triage them
// here: filter by status, search by name/email/subject, open a message to read
// the full body, and move its status (new → in_progress → resolved, or spam).
//
// Backed by the pre-existing admin API + hooks (GET/PATCH crm/contact-submissions,
// permission content.view / content.edit) — this screen is the missing UI that
// makes those captured messages visible in the CRM.
import * as React from "react";
import {
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  DateChip,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  type StatusChipTone,
  useToast,
} from "@repo/ui";
import type { ContactSubmission, ContactSubmissionStatus, MeResponse } from "@repo/types";

import { useContactSubmissionsList, useUpdateContactSubmissionStatus } from "../../hooks/use-content";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: { value: ContactSubmissionStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "spam", label: "Spam" },
];

const STATUS_TONE: Record<ContactSubmissionStatus, StatusChipTone> = {
  new: "info",
  in_progress: "warning",
  resolved: "success",
  spam: "neutral",
};

function statusLabel(status: ContactSubmissionStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

interface ContactMessageListProps {
  me: MeResponse | undefined;
}

export function ContactMessageList({ me }: ContactMessageListProps): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "content.edit");

  const [status, setStatus] = React.useState<ContactSubmissionStatus | undefined>(undefined);
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<ContactSubmission | null>(null);
  const pageSize = 20;

  const { toast } = useToast();
  const updateStatus = useUpdateContactSubmissionStatus();
  const debouncedSearch = useDebouncedValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch]);

  const { data, isLoading, isError, refetch, isFetching } = useContactSubmissionsList({
    page,
    pageSize,
    status,
    search: debouncedSearch || undefined,
  });

  async function handleMove(id: string, nextStatus: ContactSubmissionStatus) {
    try {
      const updated = await updateStatus.mutateAsync({ id, body: { status: nextStatus } });
      // Keep the open drawer in sync with the new status.
      setSelected((cur) => (cur && cur.id === id ? { ...cur, status: updated.status } : cur));
      toast({ title: "Status updated", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this message");
    }
  }

  const columns: Array<DataTableColumn<ContactSubmission>> = [
    { id: "name", header: "From", cell: (row) => row.name },
    { id: "email", header: "Email", cell: (row) => row.email },
    { id: "subject", header: "Subject", cell: (row) => row.subject ?? "—" },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={statusLabel(row.status)} /> },
    {
      id: "createdAt",
      header: "Received",
      cell: (row) => <DateChip date={new Date(row.createdAt)} format="both" />,
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="contact-messages-error"
        title="Couldn't load contact messages"
        description="Something went wrong fetching messages from the contact form."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="contact-messages-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="contact-message-list">
      <PageHeader
        title="Contact messages"
        description="Inbound enquiries from the website's Contact form. Open a message to read it and set its status."
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Name / email / subject"
        data-testid="contact-messages-filter-bar"
      >
        <Select
          label="Status"
          placeholder="All statuses"
          value={status}
          onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as ContactSubmissionStatus))}
          wrapperClassName="w-44"
          data-testid="contact-messages-status-filter"
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
        onRowClick={(row) => setSelected(row)}
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No contact messages",
          description: "Enquiries submitted through the website's Contact form will appear here.",
        }}
        caption="Contact messages"
        data-testid="contact-messages-table"
      />

      <Drawer open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DrawerContent
          title={selected?.subject || "Contact message"}
          description={selected ? `${selected.name} · ${selected.email}` : undefined}
          size="lg"
          data-testid="contact-message-drawer"
        >
          {selected ? (
            <>
              <DrawerBody>
                <div className="flex flex-col gap-6">
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-fg-muted">Name</dt>
                      <dd className="mt-1 text-fg">{selected.name}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Status</dt>
                      <dd className="mt-1">
                        <StatusChip tone={STATUS_TONE[selected.status]} label={statusLabel(selected.status)} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Email</dt>
                      <dd className="mt-1 text-fg">
                        <a className="text-brand-500 hover:underline" href={`mailto:${selected.email}`}>
                          {selected.email}
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Phone</dt>
                      <dd className="mt-1 text-fg">
                        {selected.phone ? (
                          <a className="text-brand-500 hover:underline" href={`tel:${selected.phone}`}>
                            {selected.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-fg-muted">Received</dt>
                      <dd className="mt-1 text-fg">{new Date(selected.createdAt).toLocaleString()}</dd>
                    </div>
                  </dl>

                  <div>
                    <h2 className="text-sm font-medium text-fg-muted">Message</h2>
                    <p className="mt-1 whitespace-pre-line text-sm text-fg" data-testid="contact-message-body">
                      {selected.message}
                    </p>
                  </div>
                </div>
              </DrawerBody>
              <DrawerFooter>
                <a
                  href={`mailto:${selected.email}${selected.subject ? `?subject=Re: ${encodeURIComponent(selected.subject)}` : ""}`}
                  className="inline-flex h-[var(--density-control-height)] items-center justify-center rounded-md border border-border px-[var(--density-control-px)] text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Reply by email
                </a>
                {canEdit ? (
                  <Select
                    aria-label="Set message status"
                    placeholder="Set status…"
                    value={selected.status}
                    onValueChange={(value) => handleMove(selected.id, value as ContactSubmissionStatus)}
                    wrapperClassName="w-44"
                    data-testid="contact-message-status-select"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </Select>
                ) : null}
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
