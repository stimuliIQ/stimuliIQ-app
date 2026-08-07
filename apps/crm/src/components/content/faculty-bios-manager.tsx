// Content CMS — Faculty Bios tab (public marketing bios, distinct from the
// internal faculty_profiles record). Phase 9 Completion T22/T40.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, RenderSink, Select, SelectItem, StatusChip, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from "@repo/ui";
import type { ContentStatus, FacultyBio, MeResponse } from "@repo/types";

import { useCreateFacultyBio, useDeleteFacultyBio, useFacultyBiosList, useUpdateFacultyBio } from "../../hooks/use-content";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];
const STATUS_TONE = { draft: "neutral", published: "success", archived: "danger" } as const;

function FacultyBioFormDrawer({ open, onOpenChange, bio }: { open: boolean; onOpenChange: (o: boolean) => void; bio: FacultyBio | null }): React.JSX.Element {
  const { toast } = useToast();
  const createBio = useCreateFacultyBio();
  const updateBio = useUpdateFacultyBio();
  const isEdit = Boolean(bio);

  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [bodyText, setBodyText] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus>("draft");
  const [order, setOrder] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setName(bio?.name ?? "");
    setTitle(bio?.title ?? "");
    setBodyText(bio?.bio ?? "");
    setStatus(bio?.status ?? "draft");
    setOrder(bio?.order ?? 0);
  }, [open, bio]);

  const isPending = createBio.isPending || updateBio.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, title: title || undefined, bio: bodyText, status, order };
    try {
      if (isEdit && bio) {
        await updateBio.mutateAsync({ id: bio.id, body });
        toast({ title: "Faculty bio updated", variant: "success" });
      } else {
        await createBio.mutateAsync(body);
        toast({ title: "Faculty bio created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this faculty bio");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit faculty bio" : "New faculty bio"} size="md" data-testid="faculty-bio-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dr. Priya Sharma" data-testid="faculty-bio-name-input" />
            <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Faculty, Web Development" data-testid="faculty-bio-title-input" />

            <Tabs defaultValue="write">
              <TabsList aria-label="Bio editor mode">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="write">
                <Textarea
                  id="faculty-bio-body"
                  label="Bio"
                  required
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={6}
                  placeholder="Write a short bio…"
                  data-testid="faculty-bio-body-input"
                />
              </TabsContent>
              <TabsContent value="preview">
                <RenderSink html={bodyText} data-testid="faculty-bio-preview" />
              </TabsContent>
            </Tabs>

            <div className="flex gap-3">
              <Select label="Status" placeholder="Select status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} wrapperClassName="flex-1" data-testid="faculty-bio-status-select">
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </Select>
              <Input label="Order" type="number" min={0} value={order} onChange={(e) => setOrder(Number(e.target.value))} placeholder="e.g. 1" wrapperClassName="w-28" data-testid="faculty-bio-order-input" />
            </div>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!name.trim() || !bodyText.trim()} data-testid="faculty-bio-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function FacultyBiosManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canCreate = hasPermission(me?.permissions, "content.create");
  const canEdit = hasPermission(me?.permissions, "content.edit");
  const canDelete = hasPermission(me?.permissions, "content.delete");
  const { data, isLoading, isError, refetch } = useFacultyBiosList({ page: 1, pageSize: 100 });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FacultyBio | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const deleteBio = useDeleteFacultyBio();

  function handleDelete() {
    if (!deleteId) return;
    deleteBio.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Faculty bio deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this faculty bio");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<FacultyBio>> = [
    { id: "name", header: "Name", cell: (row) => row.name },
    { id: "title", header: "Title", cell: (row) => row.title ?? "—" },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    { id: "order", header: "Order", cell: (row) => row.order, align: "right" },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            aria-label={`Delete ${row.name}`}
            data-testid={`delete-faculty-bio-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load faculty bios"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="faculty-bios-manager">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">Public marketing bios for faculty, shown on the site.</p>
        {canCreate ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="faculty-bio-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New bio
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
        emptyState={{ title: "No faculty bios yet", description: "Add your first faculty bio." }}
        caption="Faculty bios"
        data-testid="faculty-bios-table"
      />

      <FacultyBioFormDrawer open={formOpen} onOpenChange={setFormOpen} bio={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this faculty bio?"
        description="It will be soft-deleted and hidden from the site. You can restore it later."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteBio.isPending}
        data-testid="confirm-delete-faculty-bio"
      />
    </div>
  );
}
