// Colleges — dedicated CRM screen (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4). Mirrors partners-manager.tsx's list/create/edit/delete
// shape (a `Partner` row, category="college_partner") on its own screen so
// focus/established/city are front-and-center — the homepage/"For colleges" page's
// `colleges_live` sections (page-templates.schemas.ts) pull their items from here, never
// hand-entered in the page builder.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, EmptyState, Input, PageHeader, StatusChip, useToast } from "@repo/ui";
import type { College, ContentStatus, MeResponse } from "@repo/types";

import { useCollegesList, useDeleteCollege } from "../../hooks/use-colleges";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { getModulePermissions } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { CollegeFormDrawer } from "./college-form-drawer";

const STATUS_TONE: Record<ContentStatus, "neutral" | "success" | "danger"> = { draft: "neutral", published: "success", archived: "danger" };

export function CollegesManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const { canCreate, canEdit, canDelete } = getModulePermissions(me, "content");
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebouncedValue(search);
  const { data, isLoading, isError, refetch } = useCollegesList({ page: 1, pageSize: 100, ...(debouncedSearch ? { search: debouncedSearch } : {}) });
  const deleteCollege = useDeleteCollege();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<College | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  function handleDelete(): void {
    if (!deleteId) return;
    deleteCollege.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "College deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this college");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<College>> = [
    {
      id: "logo",
      header: "Logo",
      cell: (row) =>
        row.logoUrl ? (
          <img src={row.logoUrl} alt="" className="size-8 rounded object-contain" />
        ) : (
          <span className="text-xs text-fg-subtle">-</span>
        ),
    },
    { id: "name", header: "Name", cell: (row) => row.name },
    { id: "city", header: "City", cell: (row) => row.city ?? "-" },
    { id: "focus", header: "Focus", cell: (row) => row.focus ?? "-" },
    { id: "established", header: "Established", cell: (row) => row.established ?? "-", align: "right" },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteId(row.id);
            }}
            aria-label={`Delete ${row.name}`}
            data-testid={`delete-college-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load colleges"
        data-testid="colleges-manager-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="colleges-manager">
      <PageHeader
        title="Colleges"
        description={
          <>
            Partner colleges shown on the homepage and &quot;For Colleges&quot; page. Add, edit, or remove a college here
           . The public pages pull this list automatically.
          </>
        }
      />

      <div className="flex items-center justify-between gap-4">
        <Input
          aria-label="Search colleges"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="w-72"
          data-testid="colleges-search-input"
        />
        {canCreate ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="college-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New college
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={
          canEdit
            ? (row) => {
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        emptyState={{ title: "No colleges yet", description: "Add your first partner college above." }}
        caption="Colleges"
        data-testid="colleges-table"
      />

      <CollegeFormDrawer open={formOpen} onOpenChange={setFormOpen} college={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this college?"
        description="It will be soft-deleted and hidden from the site. You can restore it later."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteCollege.isPending}
        data-testid="confirm-delete-college"
      />
    </div>
  );
}
