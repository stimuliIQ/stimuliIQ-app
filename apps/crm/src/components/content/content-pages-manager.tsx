// Content CMS — Pages tab (generic block-based CMS pages). Phase 9 Completion T22/T40.
//
// GAP: `ContentPagesApi` has no `get(id)` — list only returns
// `ContentPageSummary` (no `body`). Same fix as KB articles/landing pages:
// the body field is optional when editing; leaving it blank omits `body`
// from the PATCH (preserves the existing blocks server-side).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, RenderSink, Select, SelectItem, StatusChip, statusTone, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from "@repo/ui";
import type { ContentPageSummary, ContentStatus, MeResponse } from "@repo/types";

import { useContentPagesList, useCreateContentPage, useDeleteContentPage, useUpdateContentPage } from "../../hooks/use-content";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

// CRITICAL fix — UX audit finding B1 ("the Pages tab is a trap"): rows where
// `isBuilderManaged` is true are your main website pages (Home, About, Gallery…),
// already editable in Page Builder. The generic edit-drawer/delete here have ALWAYS
// 403'd for these rows (`content-pages.service.ts`'s `content.builder_managed_forbidden`
// guard) — this tab's edit/delete affordances never worked for them, so hiding those
// affordances and pointing to Page Builder instead is zero functionality loss.
/** Pure gating helper (unit-tested separately from the DataTable wiring): a
 *  builder-managed row's generic edit/delete has always 403'd server-side, so the row
 *  is never clickable-to-edit here regardless of the viewer's `content.edit` grant. */
export function isContentPageRowEditable(row: Pick<ContentPageSummary, "isBuilderManaged">): boolean {
  return !row.isBuilderManaged;
}

function BuilderManagedBadge({ pageId }: { pageId: string }): React.JSX.Element {
  return (
    <Link to="/marketing/page-builder" onClick={(e) => e.stopPropagation()} className="w-fit">
      <StatusChip
        tone="info"
        size="sm"
        label="Edited in Page Builder"
        icon={<ExternalLink className="size-3" aria-hidden="true" />}
        className="hover:underline"
        data-testid={`content-page-builder-managed-badge-${pageId}`}
      />
    </Link>
  );
}

const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];
// `archived` = warning, not danger (docs/specs/crm-ui-consistency.md §2) — was
// diverging from program-status-chip.tsx's archived: warning.
const STATUS_TONE = { draft: statusTone("draft"), published: statusTone("published"), archived: statusTone("archived") } as const;

function ContentPageFormDrawer({ open, onOpenChange, page }: { open: boolean; onOpenChange: (o: boolean) => void; page: ContentPageSummary | null }): React.JSX.Element {
  const { toast } = useToast();
  const createPage = useCreateContentPage();
  const updatePage = useUpdateContentPage();
  const isEdit = Boolean(page);

  const [slug, setSlug] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [html, setHtml] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus>("draft");

  React.useEffect(() => {
    if (!open) return;
    setSlug(page?.slug ?? "");
    setTitle(page?.title ?? "");
    setHtml("");
    setStatus(page?.status ?? "draft");
  }, [open, page]);

  const isPending = createPage.isPending || updatePage.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = html.trim() ? [{ type: "richtext", data: { html } }] : undefined;
    try {
      if (isEdit && page) {
        await updatePage.mutateAsync({ id: page.id, body: { slug, title, ...(body ? { body } : {}), status } });
        toast({ title: "Page updated", variant: "success" });
      } else {
        await createPage.mutateAsync({ slug, title, body: body ?? [], status });
        toast({ title: "Page created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this page");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit page" : "New page"} size="lg" data-testid="content-page-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. About Us" data-testid="content-page-title-input" />
            <Input label="Slug (may contain /)" required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. about-us or legal/privacy-policy" data-testid="content-page-slug-input" />

            <Tabs defaultValue="write">
              <TabsList aria-label="Body editor mode">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  id="content-page-body"
                  aria-label="Page content (HTML)"
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={10}
                  placeholder={isEdit ? "Leave blank to keep the existing content unchanged" : "<p>Page content (HTML)…</p>"}
                  data-testid="content-page-body-input"
                />
              </TabsContent>
              <TabsContent value="preview">
                <RenderSink html={html} emptyTitle="Nothing to preview" data-testid="content-page-preview" />
              </TabsContent>
            </Tabs>

            <Select label="Status" placeholder="Select status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} data-testid="content-page-status-select">
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </Select>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!title.trim() || !slug.trim()} data-testid="content-page-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function ContentPagesManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canCreate = hasPermission(me?.permissions, "content.create");
  const canEdit = hasPermission(me?.permissions, "content.edit");
  const canDelete = hasPermission(me?.permissions, "content.delete");
  const { data, isLoading, isError, refetch } = useContentPagesList({ page: 1, pageSize: 100 });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ContentPageSummary | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const deletePage = useDeleteContentPage();

  function handleDelete() {
    if (!deleteId) return;
    deletePage.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Page deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this page");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<ContentPageSummary>> = [
    {
      id: "title",
      header: "Title",
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span>{row.title}</span>
          {row.isBuilderManaged ? <BuilderManagedBadge pageId={row.id} /> : null}
        </div>
      ),
    },
    { id: "slug", header: "Slug", cell: (row) => row.slug },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        // Builder-managed rows never get edit/delete here — see `BuilderManagedBadge` above.
        !row.isBuilderManaged && canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            aria-label={`Delete ${row.title}`}
            data-testid={`delete-content-page-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load pages"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="content-pages-manager">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          Plain pages like a privacy policy or terms of service. Your main website pages (Home, About, Gallery…) are
          edited in{" "}
          <Link to="/marketing/page-builder" className="font-medium text-brand-500 hover:underline">
            Page Builder
          </Link>
          .
        </p>
        {canCreate ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="content-page-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New page
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
                if (!isContentPageRowEditable(row)) return;
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        emptyState={{ title: "No pages yet", description: "Create your first content page." }}
        caption="Content pages"
        data-testid="content-pages-table"
      />

      <ContentPageFormDrawer open={formOpen} onOpenChange={setFormOpen} page={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this page?"
        description="It will be soft-deleted and hidden from the site. You can restore it later."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deletePage.isPending}
        data-testid="confirm-delete-content-page"
      />
    </div>
  );
}
