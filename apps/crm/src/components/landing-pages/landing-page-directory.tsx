// Landing page directory — CRUD + A/B variants. Phase 9 Completion T33/T40.
import * as React from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { LandingPageSummary, MeResponse } from "@repo/types";

import { useDeleteLandingPage, useLandingPagesList } from "../../hooks/use-landing-pages";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { landingPageUrl } from "../../lib/public-urls";
import { LandingPageFormDrawer } from "./landing-page-form-drawer";

const STATUS_TONE = { draft: "neutral", published: "success", archived: "danger" } as const;

// UX audit finding L1: "Variant: a" is insider A/B-testing jargon. Render a friendly
// "Version A"/"Version B" label for the common single-letter case; fall back to the raw
// value (still shown, never hidden) for anything else so no data is lost.
function formatVersionLabel(variant: string): string {
  const trimmed = variant.trim();
  if (/^[a-z]$/i.test(trimmed)) return `Version ${trimmed.toUpperCase()}`;
  return trimmed ? `Version ${trimmed}` : "Version A";
}

export function LandingPageDirectory({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const canEdit = hasPermission(me?.permissions, "landing_pages.edit");
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LandingPageSummary | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const pageSize = 20;

  const debouncedSearch = useDebouncedValue(search);
  React.useEffect(() => setPage(1), [debouncedSearch]);

  const { data, isLoading, isFetching, isError, refetch } = useLandingPagesList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
  });

  const deleteMutation = useDeleteLandingPage();

  function handleDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Landing page deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete landing page", description: (err as Error).message, variant: "destructive" });
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<LandingPageSummary>> = [
    { id: "title", header: "Title", cell: (row) => row.title },
    {
      id: "slug",
      header: "Web address",
      cell: (row) => (
        <a
          href={landingPageUrl(row.slug)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 font-mono text-xs text-fg-muted hover:text-fg hover:underline"
          aria-label={`View live page for ${row.title} (opens in a new tab)`}
          data-testid={`landing-page-view-live-${row.id}`}
        >
          /lp/{row.slug}
          <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        </a>
      ),
    },
    { id: "campaign", header: "Campaign", cell: (row) => row.campaign ?? "-" },
    {
      id: "variant",
      header: (
        <span title="A/B test versions. Visitors are split between versions of the same campaign.">Version</span>
      ),
      cell: (row) => formatVersionLabel(row.variant),
    },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    { id: "createdAt", header: "Created", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: (row: LandingPageSummary) => (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(row);
                    setFormOpen(true);
                  }}
                  aria-label={`Edit landing page ${row.title}`}
                  data-testid={`edit-landing-page-${row.id}`}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteId(row.id);
                  }}
                  aria-label={`Delete landing page ${row.title}`}
                  data-testid={`delete-landing-page-${row.id}`}
                >
                  <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
                </Button>
              </div>
            ),
          } satisfies DataTableColumn<LandingPageSummary>,
        ]
      : []),
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load landing pages"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="landing-pages-error"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="landing-page-directory">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          Campaign-specific pages, each with an optional Version for A/B testing.
        </p>
        {canEdit ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="landing-page-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New page
          </Button>
        ) : null}
      </div>

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Title or slug…"
        data-testid="landing-page-filter-bar"
      />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={
          canEdit
            ? (row) => {
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{ title: "No landing pages yet", description: "Create your first campaign page." }}
        caption="Landing pages"
        data-testid="landing-page-table"
      />

      <LandingPageFormDrawer open={formOpen} onOpenChange={setFormOpen} page={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this landing page?"
        description="It will be soft-deleted. Existing analytics data is retained in the audit log."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
        data-testid="confirm-delete-landing-page"
      />
    </div>
  );
}
