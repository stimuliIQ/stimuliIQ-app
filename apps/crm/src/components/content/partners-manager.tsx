// Content CMS — Partners tab (hiring/tech partner logos). Phase 9 Completion T22/T40.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, Select, SelectItem, StatusChip, useToast } from "@repo/ui";
import type { ContentStatus, MeResponse, Partner } from "@repo/types";

import { useCreatePartner, useDeletePartner, usePartnersList, useUpdatePartner } from "../../hooks/use-content";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];
const STATUS_TONE = { draft: "neutral", published: "success", archived: "danger" } as const;

function PartnerFormDrawer({ open, onOpenChange, partner }: { open: boolean; onOpenChange: (o: boolean) => void; partner: Partner | null }): React.JSX.Element {
  const { toast } = useToast();
  const createPartner = useCreatePartner();
  const updatePartner = useUpdatePartner();
  const isEdit = Boolean(partner);

  const [name, setName] = React.useState("");
  const [logoKey, setLogoKey] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus>("draft");
  const [order, setOrder] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setName(partner?.name ?? "");
    setLogoKey("");
    setUrl(partner?.url ?? "");
    setCategory(partner?.category ?? "");
    setStatus(partner?.status ?? "draft");
    setOrder(partner?.order ?? 0);
  }, [open, partner]);

  const isPending = createPartner.isPending || updatePartner.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, logoKey: logoKey || undefined, url: url || undefined, category: category || undefined, status, order };
    try {
      if (isEdit && partner) {
        await updatePartner.mutateAsync({ id: partner.id, body });
        toast({ title: "Partner updated", variant: "success" });
      } else {
        await createPartner.mutateAsync(body);
        toast({ title: "Partner created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this partner");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit partner" : "New partner"} size="sm" data-testid="partner-form-drawer">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp" data-testid="partner-name-input" />
            <Input label="Logo storage key (optional)" value={logoKey} onChange={(e) => setLogoKey(e.target.value)} placeholder="e.g. partners/acme-logo.png" helperText={isEdit ? "Leave blank to keep the existing logo" : undefined} data-testid="partner-logo-key-input" />
            <Input label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="partner-url-input" />
            <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Hiring Partner" data-testid="partner-category-input" />
            <div className="flex gap-3">
              <Select label="Status" placeholder="Select status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} wrapperClassName="flex-1" data-testid="partner-status-select">
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </Select>
              <Input label="Order" type="number" min={0} value={order} onChange={(e) => setOrder(Number(e.target.value))} placeholder="e.g. 1" wrapperClassName="w-28" data-testid="partner-order-input" />
            </div>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isPending} disabled={!name.trim()} data-testid="partner-form-submit">
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function PartnersManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canCreate = hasPermission(me?.permissions, "content.create");
  const canEdit = hasPermission(me?.permissions, "content.edit");
  const canDelete = hasPermission(me?.permissions, "content.delete");
  const { data, isLoading, isError, refetch } = usePartnersList({ page: 1, pageSize: 100 });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Partner | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const deletePartner = useDeletePartner();

  function handleDelete() {
    if (!deleteId) return;
    deletePartner.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Partner deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this partner");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<Partner>> = [
    { id: "name", header: "Name", cell: (row) => row.name },
    { id: "category", header: "Category", cell: (row) => row.category ?? "—" },
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
            data-testid={`delete-partner-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load partners"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="partners-manager">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">Hiring/tech partner logos shown on the marketing site.</p>
        {canCreate ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="partner-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New partner
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
        emptyState={{ title: "No partners yet", description: "Add your first partner logo." }}
        caption="Partners"
        data-testid="partners-table"
      />

      <PartnerFormDrawer open={formOpen} onOpenChange={setFormOpen} partner={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this partner?"
        description="It will be soft-deleted and hidden from the site. You can restore it later."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deletePartner.isPending}
        data-testid="confirm-delete-partner"
      />
    </div>
  );
}
