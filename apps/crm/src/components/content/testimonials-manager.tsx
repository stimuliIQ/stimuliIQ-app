// Testimonials — dedicated CRM screen (promoted out of the Blog CMS tab strip
// to mirror the Colleges screen). Uses `TestimonialInput` (@repo/ui) for the
// quote/rating/name core, plus program/status/order fields the CMS record
// needs beyond that display-focused shape. Phase 9 Completion T22/T40.
import * as React from "react";
import { Star, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, PageHeader, Select, SelectItem, StatusChip, TestimonialInput, type TestimonialFormValues, useToast } from "@repo/ui";
import type { ContentStatus, MeResponse, Testimonial } from "@repo/types";

import { useCreateTestimonial, useDeleteTestimonial, useTestimonialsList, useUpdateTestimonial } from "../../hooks/use-content";
import { useProgramsList } from "../../hooks/use-courses";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: ContentStatus[] = ["draft", "published", "archived"];
const STATUS_TONE = { draft: "neutral", published: "success", archived: "danger" } as const;

function TestimonialFormDrawer({
  open,
  onOpenChange,
  testimonial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testimonial: Testimonial | null;
}): React.JSX.Element {
  const { toast } = useToast();
  const createTestimonial = useCreateTestimonial();
  const updateTestimonial = useUpdateTestimonial();
  const { data: programs } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const isEdit = Boolean(testimonial);

  const [form, setForm] = React.useState<TestimonialFormValues>({ quote: "", ratingStars: 5, studentName: "" });
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  const [status, setStatus] = React.useState<ContentStatus>("draft");
  const [order, setOrder] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      quote: testimonial?.quote ?? "",
      ratingStars: testimonial?.rating ? testimonial.rating / 10 : 5,
      studentName: testimonial?.studentName ?? "",
    });
    setProgramId(testimonial?.programId ?? undefined);
    setStatus(testimonial?.status ?? "draft");
    setOrder(testimonial?.order ?? 0);
  }, [open, testimonial]);

  const isPending = createTestimonial.isPending || updateTestimonial.isPending;

  async function handleSubmit() {
    const body = {
      programId: programId ?? null,
      studentName: form.studentName,
      quote: form.quote,
      rating: Math.round(form.ratingStars * 10),
      status,
      order,
    };
    try {
      if (isEdit && testimonial) {
        await updateTestimonial.mutateAsync({ id: testimonial.id, body });
        toast({ title: "Testimonial updated", variant: "success" });
      } else {
        await createTestimonial.mutateAsync(body);
        toast({ title: "Testimonial created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this testimonial");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit testimonial" : "New testimonial"} size="md" data-testid="testimonial-form-drawer">
        <DrawerBody className="flex flex-col gap-4">
          <TestimonialInput value={form} onChange={setForm} data-testid="testimonial-core-input" />
          <Select label="Program (optional)" placeholder="No program" value={programId} onValueChange={setProgramId} data-testid="testimonial-program-select">
            {(programs?.items ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </Select>
          <div className="flex gap-3">
            <Select label="Status" placeholder="Select status" value={status} onValueChange={(v) => setStatus(v as ContentStatus)} wrapperClassName="flex-1" data-testid="testimonial-status-select">
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </Select>
            <Input label="Display order" type="number" min={0} value={order} onChange={(e) => setOrder(Number(e.target.value))} placeholder="e.g. 1" wrapperClassName="w-32" data-testid="testimonial-order-input" />
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isPending} disabled={!form.studentName.trim() || !form.quote.trim()} data-testid="testimonial-form-submit">
            {isEdit ? "Save changes" : "Create"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function TestimonialsManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canCreate = hasPermission(me?.permissions, "content.create");
  const canEdit = hasPermission(me?.permissions, "content.edit");
  const canDelete = hasPermission(me?.permissions, "content.delete");
  const { data, isLoading, isError, refetch } = useTestimonialsList({ page: 1, pageSize: 100 });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Testimonial | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const deleteTestimonial = useDeleteTestimonial();

  function handleDelete() {
    if (!deleteId) return;
    deleteTestimonial.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Testimonial deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this testimonial");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<Testimonial>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    { id: "quote", header: "Quote", cell: (row) => <span className="line-clamp-1">{row.quote}</span> },
    { id: "rating", header: "Rating", cell: (row) => (row.rating ? `${(row.rating / 10).toFixed(1)} ★` : "—") },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            aria-label={`Delete testimonial from ${row.studentName}`}
            data-testid={`delete-testimonial-${row.id}`}
          >
            <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
          </Button>
        ) : null,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load testimonials"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="testimonials-manager">
      <PageHeader
        title="Testimonials"
        description={
          <>
            Student testimonials shown in the &quot;What Our Students Say&quot; section on the homepage. Add, edit, or
            remove a testimonial here — the public site pulls the published ones automatically.
          </>
        }
      />

      {canCreate ? (
        <div className="flex items-center justify-end gap-4">
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="testimonial-create-button"
          >
            <Star className="size-4" aria-hidden="true" />
            New testimonial
          </Button>
        </div>
      ) : null}

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
        emptyState={{ title: "No testimonials yet", description: "Add your first student testimonial." }}
        caption="Testimonials"
        data-testid="testimonials-table"
      />

      <TestimonialFormDrawer open={formOpen} onOpenChange={setFormOpen} testimonial={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this testimonial?"
        description="It will be soft-deleted and hidden from the site. You can restore it later."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteTestimonial.isPending}
        data-testid="confirm-delete-testimonial"
      />
    </div>
  );
}
