// Content CMS — Blog tab: categories mini-manager + post draft/publish CRUD
// with a RenderSink preview. Phase 9 Completion T22/T40.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, RenderSink, Select, SelectItem, Skeleton, StatusChip, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from "@repo/ui";
import type { BlogPostSummary, ContentStatus, MeResponse } from "@repo/types";

import {
  useBlogCategories,
  useBlogPost,
  useBlogPostsList,
  useCreateBlogCategory,
  useCreateBlogPost,
  useDeleteBlogPost,
  useUpdateBlogPost,
} from "../../hooks/use-content";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_TONE = { draft: "neutral", published: "success", archived: "danger" } as const;
const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];

function BlogPostFormDrawer({
  open,
  onOpenChange,
  postId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string | null;
}): React.JSX.Element {
  const { toast } = useToast();
  const { data: post, isLoading } = useBlogPost(postId ?? undefined);
  const { data: categories } = useBlogCategories();
  const createPost = useCreateBlogPost();
  const updatePost = useUpdateBlogPost();
  const isEdit = Boolean(postId);

  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [excerpt, setExcerpt] = React.useState("");
  const [body, setBody] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<string | undefined>(undefined);
  const [status, setStatus] = React.useState<ContentStatus>("draft");

  React.useEffect(() => {
    if (!open) return;
    if (postId && post) {
      setTitle(post.title);
      setSlug(post.slug);
      setExcerpt(post.excerpt ?? "");
      setBody(post.body);
      setCategoryId(post.categoryId ?? undefined);
      setStatus(post.status);
    } else if (!postId) {
      setTitle("");
      setSlug("");
      setExcerpt("");
      setBody("");
      setCategoryId(undefined);
      setStatus("draft");
    }
  }, [open, postId, post]);

  const isPending = createPost.isPending || updatePost.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEdit && postId) {
        await updatePost.mutateAsync({ id: postId, body: { title, slug, excerpt: excerpt || undefined, body: body, categoryId: categoryId ?? null, status } });
        toast({ title: "Post updated", variant: "success" });
      } else {
        await createPost.mutateAsync({ title, slug, excerpt: excerpt || undefined, body, categoryId: categoryId ?? undefined, status });
        toast({ title: "Post created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this post");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit post" : "New post"} size="lg" data-testid="blog-post-form-drawer">
        {isEdit && isLoading ? (
          <DrawerBody>
            <Skeleton shape="block" className="h-64" />
          </DrawerBody>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How we scaled to 100k students" data-testid="blog-post-title-input" />
              <Input label="Slug" required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. how-we-scaled-to-100k-students" data-testid="blog-post-slug-input" />
              <Input label="Excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Short summary shown in listings…" data-testid="blog-post-excerpt-input" />

              <Select label="Category" placeholder="No category" value={categoryId} onValueChange={setCategoryId} data-testid="blog-post-category-select">
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </Select>

              <Tabs defaultValue="write">
                <TabsList aria-label="Body editor mode">
                  <TabsTrigger value="write">Write</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                <TabsContent value="write">
                  <Textarea
                    id="blog-post-body"
                    label="Body (HTML)"
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={10}
                    placeholder="Write the post body (HTML)…"
                    data-testid="blog-post-body-input"
                  />
                </TabsContent>
                <TabsContent value="preview">
                  <RenderSink html={body} data-testid="blog-post-preview" />
                </TabsContent>
              </Tabs>

              <Select label="Status" placeholder="Select status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} data-testid="blog-post-status-select">
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
              <Button type="submit" loading={isPending} disabled={!title.trim() || !slug.trim() || !body.trim()} data-testid="blog-post-form-submit">
                {isEdit ? "Save changes" : "Create"}
              </Button>
            </DrawerFooter>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function CategoryQuickAdd({ canEdit }: { canEdit: boolean }): React.JSX.Element | null {
  const { toast } = useToast();
  const createCategory = useCreateBlogCategory();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");

  if (!canEdit) return null;

  async function handleAdd() {
    try {
      await createCategory.mutateAsync({ name, slug });
      toast({ title: "Category created", variant: "success" });
      setName("");
      setSlug("");
    } catch (error) {
      surfaceError(toast, error, "Couldn't create this category");
    }
  }

  return (
    <div className="flex items-end gap-2">
      <Input label="New category name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Web Development" wrapperClassName="w-48" data-testid="blog-category-name-input" />
      <Input label="Slug" required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. web-development" wrapperClassName="w-40" data-testid="blog-category-slug-input" />
      <Button variant="secondary" size="sm" onClick={handleAdd} disabled={!name.trim() || !slug.trim()} loading={createCategory.isPending} data-testid="blog-category-add">
        Add category
      </Button>
    </div>
  );
}

export function BlogManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canEdit = hasPermission(me?.permissions, "content.edit");
  const canCreate = hasPermission(me?.permissions, "content.create");
  const canDelete = hasPermission(me?.permissions, "content.delete");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const pageSize = 20;

  const debouncedSearch = useDebouncedValue(search);
  React.useEffect(() => setPage(1), [debouncedSearch]);

  const { data, isLoading, isFetching, isError, refetch } = useBlogPostsList({ page, pageSize, search: debouncedSearch || undefined });
  const deletePost = useDeleteBlogPost();

  function handleDelete() {
    if (!deleteId) return;
    deletePost.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Post deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this post");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<BlogPostSummary>> = [
    { id: "title", header: "Title", cell: (row) => row.title },
    { id: "categoryName", header: "Category", cell: (row) => row.categoryName ?? "-" },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    { id: "createdAt", header: "Created", cell: (row) => new Date(row.createdAt).toLocaleDateString(), align: "right" },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            aria-label={`Delete ${row.title}`}
            data-testid={`delete-blog-post-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load blog posts"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="blog-manager">
      <div className="flex items-center justify-between gap-4">
        <Input label="Search" placeholder="Post title…" value={search} onChange={(e) => setSearch(e.target.value)} wrapperClassName="w-64" data-testid="blog-post-search-input" />
        {canCreate ? (
          <Button
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
            data-testid="blog-post-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New post
          </Button>
        ) : null}
      </div>

      <CategoryQuickAdd canEdit={canEdit} />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => {
          setEditingId(row.id);
          setFormOpen(true);
        }}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{ title: "No posts yet", description: "Write your first blog post." }}
        caption="Blog posts"
        data-testid="blog-post-table"
      />

      <BlogPostFormDrawer open={formOpen} onOpenChange={setFormOpen} postId={editingId} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this post?"
        description="It will be soft-deleted and hidden from the site. You can restore it later."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deletePost.isPending}
        data-testid="confirm-delete-blog-post"
      />
    </div>
  );
}
