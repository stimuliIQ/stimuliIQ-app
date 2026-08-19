// CRM ▸ Careers ▸ Openings — the job adverts shown on the public careers page (ADR-0066).
// Mirrors colleges-manager.tsx's list/create/edit/delete shape.
//
// THE COLUMN THAT MATTERS IS "APPLICANTS", not status. Somebody opening this screen is
// usually asking "is anyone waiting on me?", so the pending count is rendered as a call to
// action that navigates straight into that opening's filtered queue — the alternative is
// reading a number here and then re-finding the role by hand on the next screen.
//
// Closing versus deleting: the row action is CLOSE, and delete is behind the drawer's own
// affordance. Closing takes the advert off the site while keeping its applications attached
// to a named role, which is what "we finished hiring" actually means; deleting is for an
// advert posted by mistake, and the confirm copy says so.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  type StatusChipTone,
  useToast,
} from "@repo/ui";
import type { JobOpening, JobOpeningStatus, MeResponse } from "@repo/types";

import { useDeleteJobOpening, useJobOpeningsList, useUpdateJobOpening } from "../../hooks/use-careers";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { jobOpeningUrl } from "../../lib/public-urls";
import { JobOpeningFormDrawer } from "./job-opening-form-drawer";

const STATUS_TONE: Record<JobOpeningStatus, StatusChipTone> = {
  draft: "neutral",
  published: "success",
  closed: "danger",
};

/**
 * A published opening past its closing date is still `published` in the database but is no
 * longer on the site. Showing it as plain "published" would be a lie a reviewer acts on, so
 * it reads as "Lapsed" — the honest description of published-but-not-visible.
 */
function statusLabel(row: JobOpening): string {
  if (row.status === "published" && !row.isLive) return "Lapsed";
  return row.status;
}

function statusToneFor(row: JobOpening): StatusChipTone {
  if (row.status === "published" && !row.isLive) return "warning";
  return STATUS_TONE[row.status];
}

export function JobOpeningsManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canManage = hasPermission(me?.permissions, "careers.openings.manage");

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<JobOpeningStatus | "">("");
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError, refetch } = useJobOpeningsList({
    page: 1,
    pageSize: 100,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status ? { status } : {}),
  });

  const updateOpening = useUpdateJobOpening();
  const deleteOpening = useDeleteJobOpening();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<JobOpening | null>(null);
  const [closing, setClosing] = React.useState<JobOpening | null>(null);
  const [deleting, setDeleting] = React.useState<JobOpening | null>(null);

  function handleClose(): void {
    if (!closing) return;
    updateOpening.mutate(
      { id: closing.id, body: { status: "closed" } },
      {
        onSuccess: () => {
          toast({ title: "Opening closed", description: "It is no longer on the website.", variant: "success" });
          setClosing(null);
        },
        onError: (error) => {
          surfaceError(toast, error, "Couldn't close this opening");
          setClosing(null);
        },
      },
    );
  }

  function handleDelete(): void {
    if (!deleting) return;
    deleteOpening.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: "Opening deleted", variant: "success" });
        setDeleting(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this opening");
        setDeleting(null);
      },
    });
  }

  const columns: Array<DataTableColumn<JobOpening>> = [
    {
      id: "title",
      header: "Role",
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{row.title}</div>
          <div className="text-xs text-fg-subtle">
            {row.employmentType} · {row.location}
            {row.department ? ` · ${row.department}` : ""}
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={statusToneFor(row)} label={statusLabel(row)} size="sm" />,
    },
    {
      id: "applicants",
      header: "Applicants",
      align: "right",
      cell: (row) => {
        if (row.applicationCount === 0) return <span className="text-xs text-fg-subtle">—</span>;
        return (
          <Link
            to="/careers/applications"
            search={{ jobOpeningId: row.id }}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded px-1 text-sm font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`opening-applicants-${row.id}`}
          >
            {row.applicationCount}
            {row.pendingApplicationCount > 0 ? (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-warning-fg">
                {row.pendingApplicationCount} new
              </span>
            ) : null}
          </Link>
        );
      },
    },
    {
      id: "closesOn",
      header: "Closes",
      cell: (row) => row.closesOn ?? <span className="text-xs text-fg-subtle">No end date</span>,
    },
    {
      id: "link",
      header: "Public link",
      cell: (row) =>
        row.isLive ? (
          <a
            href={jobOpeningUrl(row.slug)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-sm text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open the public page for ${row.title}`}
            data-testid={`opening-public-link-${row.id}`}
          >
            View <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-xs text-fg-subtle">Not live</span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canManage ? (
          <div className="flex items-center gap-1">
            {row.status !== "closed" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setClosing(row);
                }}
                data-testid={`close-opening-${row.id}`}
              >
                Close
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setDeleting(row);
              }}
              aria-label={`Delete ${row.title}`}
              data-testid={`delete-opening-${row.id}`}
            >
              <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
            </Button>
          </div>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load openings"
        data-testid="job-openings-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="job-openings-manager">
      <PageHeader
        title="Job openings"
        description="The roles advertised on the public careers page. Publishing one puts it on the website straight away; applications arrive under Careers ▸ Applications."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            aria-label="Search openings"
            placeholder="Search by title, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            wrapperClassName="w-72"
            data-testid="openings-search-input"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onValueChange={(value) => setStatus((value as JobOpeningStatus) || "")}
            wrapperClassName="w-48"
            data-testid="openings-status-filter"
          >
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </Select>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="opening-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New opening
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={
          canManage
            ? (row) => {
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        emptyState={{
          title: "No openings yet",
          description: "Create one to advertise a role on the careers page. Nothing goes public until you publish it.",
        }}
        caption="Job openings"
        data-testid="openings-table"
      />

      <JobOpeningFormDrawer open={formOpen} onOpenChange={setFormOpen} opening={editing} />

      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(open) => !open && setClosing(null)}
        title={`Close "${closing?.title ?? ""}"?`}
        description={
          closing && closing.pendingApplicationCount > 0
            ? `It comes off the website immediately. ${closing.pendingApplicationCount} application${closing.pendingApplicationCount === 1 ? "" : "s"} still awaiting a decision will stay in your queue — closing the advert does not decide them.`
            : "It comes off the website immediately. Its applications are kept, and you can publish it again next time you hire for this role."
        }
        confirmLabel="Close opening"
        onConfirm={handleClose}
        loading={updateOpening.isPending}
        data-testid="confirm-close-opening"
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description={
          deleting && deleting.applicationCount > 0
            ? `This opening has ${deleting.applicationCount} application${deleting.applicationCount === 1 ? "" : "s"}. They are kept and still show what each person applied for, but they will no longer be grouped under this role. If you have simply finished hiring, close it instead.`
            : "Use this only for an advert posted by mistake. If you have finished hiring, close it instead — that keeps it for next time."
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteOpening.isPending}
        data-testid="confirm-delete-opening"
      />
    </div>
  );
}
