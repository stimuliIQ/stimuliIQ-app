// Knowledge-base article directory — draft/publish CRUD with a RenderSink
// preview. Phase 9 Completion T21/T38 (docs/plans/phase-9-completion.md).
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataFilterBar, DataTable, type DataTableColumn, EmptyState, PageHeader, StatusChip, useToast } from "@repo/ui";
import type { KbArticleSummary, MeResponse } from "@repo/types";

import { useDeleteKbArticle, useKbArticlesList } from "../../hooks/use-tickets";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { KbArticleFormDrawer } from "./kb-article-form-drawer";

export function KbArticleDirectory({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  // Backend only has kb.view/kb.edit (no separate kb.create) — see
  // apps/api/src/modules/tickets/kb-articles.controller.ts.
  const canEdit = hasPermission(me?.permissions, "kb.edit");
  const canDelete = canEdit;
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingArticle, setEditingArticle] = React.useState<KbArticleSummary | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const pageSize = 20;

  const { toast } = useToast();
  const deleteKbArticle = useDeleteKbArticle();

  const debouncedSearch = useDebouncedValue(search);
  React.useEffect(() => setPage(1), [debouncedSearch]);

  const { data, isLoading, isFetching, isError, refetch } = useKbArticlesList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
  });

  function handleDelete() {
    if (!deleteId) return;
    deleteKbArticle.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete", description: (err as Error).message, variant: "destructive" });
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<KbArticleSummary>> = [
    { id: "title", header: "Title", cell: (row) => row.title, sortable: false },
    { id: "category", header: "Category", cell: (row) => row.category ?? "—" },
    {
      id: "published",
      header: "Status",
      cell: (row) => (row.published ? <StatusChip tone="success" label="Published" size="sm" /> : <StatusChip tone="neutral" label="Draft" size="sm" />),
    },
    { id: "createdAt", header: "Created", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: (row: KbArticleSummary) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteId(row.id);
                }}
                aria-label={`Delete article ${row.title}`}
                data-testid={`delete-kb-${row.id}`}
              >
                <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
              </Button>
            ),
          } satisfies DataTableColumn<KbArticleSummary>,
        ]
      : []),
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load the knowledge base"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="kb-directory-error"
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="kb-article-directory">
      <PageHeader
        title="Knowledge base"
        description="Self-service articles surfaced to students and agents."
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditingArticle(null);
                setFormOpen(true);
              }}
              data-testid="kb-article-create-button"
            >
              <Plus className="size-4" aria-hidden="true" />
              New article
            </Button>
          ) : null
        }
      />

      <DataFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel="Search"
        searchPlaceholder="Title…"
        data-testid="kb-article-filter-bar"
      />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => {
          setEditingArticle(row);
          setFormOpen(true);
        }}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{ title: "No articles yet", description: "Create your first knowledge-base article." }}
        caption="Knowledge base articles"
        data-testid="kb-article-table"
      />

      <KbArticleFormDrawer open={formOpen} onOpenChange={setFormOpen} article={editingArticle} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this article?"
        description="It will be soft-deleted and removed from the help center."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteKbArticle.isPending}
        data-testid="confirm-delete-kb"
      />
    </div>
  );
}
