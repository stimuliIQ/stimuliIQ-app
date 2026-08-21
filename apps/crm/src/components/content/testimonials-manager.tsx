// Reviews — dedicated CRM screen (promoted out of the Blog CMS tab strip to mirror the
// Colleges screen). Uses `TestimonialInput` (@repo/ui) for the quote/rating/name core, plus
// program/status/order fields the CMS record needs beyond that display-focused shape.
// Phase 9 Completion T22/T40.
//
// NAMING: the screen says "Reviews" — every label, toast, dialog and empty state — while the
// model, the API (`/public/testimonials`, `content.testimonials.*`), the `Testimonial` type
// and the public-site page at /testimonials all still say "testimonial". That split is
// deliberate, not a half-finished rename: the request was to change what STAFF read, and
// renaming the domain would mean a table rename, a shipped public URL, and every consumer
// of the type — a migration, for a word. Code identifiers here therefore stay on
// `Testimonial` so they keep matching the API they call; only the strings changed.
import * as React from "react";
import { Star, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, PageHeader, Select, SelectItem, StatusChip, Switch, TestimonialInput, type TestimonialFormValues, useToast } from "@repo/ui";
import type { ContentStatus, MeResponse, Testimonial } from "@repo/types";

import { useCreateTestimonial, useDeleteTestimonial, usePublishTestimonial, useTestimonialsList, useUpdateTestimonial } from "../../hooks/use-content";
import { useProgramsList } from "../../hooks/use-courses";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

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
  const publishTestimonial = usePublishTestimonial();
  const { data: programs } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const isEdit = Boolean(testimonial);

  const [form, setForm] = React.useState<TestimonialFormValues>({ quote: "", ratingStars: 5, studentName: "" });
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  // One boolean, not the three-way ContentStatus. `draft` and `archived` are both simply
  // "not on the site" for a testimonial — the public read filters on status="published"
  // and nothing else — so a tri-state picker only ever asked staff to pick between two
  // synonyms for hidden. Off writes `draft`; an existing `archived` row shows as off.
  const [onWebsite, setOnWebsite] = React.useState(false);
  const [order, setOrder] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      quote: testimonial?.quote ?? "",
      ratingStars: testimonial?.rating ? testimonial.rating / 10 : 5,
      studentName: testimonial?.studentName ?? "",
    });
    setProgramId(testimonial?.programId ?? undefined);
    setOnWebsite(testimonial?.status === "published");
    setOrder(testimonial?.order ?? 0);
  }, [open, testimonial]);

  const isPending = createTestimonial.isPending || updateTestimonial.isPending || publishTestimonial.isPending;

  async function handleSubmit() {
    // Publishing is a dedicated endpoint, not a status field: the API rejects
    // `status:"published"` on create/PATCH (publish gate). So every save writes the
    // content with a NOT-published status first, then publishes as a second call when the
    // toggle is on. Turning the toggle OFF is just a patch to `draft`.
    const base = {
      programId: programId ?? null,
      studentName: form.studentName,
      quote: form.quote,
      rating: Math.round(form.ratingStars * 10),
      order,
    };
    try {
      let id: string;
      if (isEdit && testimonial) {
        await updateTestimonial.mutateAsync({
          id: testimonial.id,
          body: { ...base, ...(onWebsite ? {} : { status: "draft" as ContentStatus }) },
        });
        id = testimonial.id;
      } else {
        const created = await createTestimonial.mutateAsync({ ...base, status: "draft", order });
        id = created.id;
      }

      if (onWebsite) {
        await publishTestimonial.mutateAsync(id);
      }

      toast({
        title: isEdit ? "Review updated" : "Review created",
        description: onWebsite
          ? "It's live in the \"What Our Students Say\" section."
          : "Hidden from the website until you turn on \"Show on website\".",
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this review");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={isEdit ? "Edit review" : "New review"} size="md" data-testid="testimonial-form-drawer">
        <DrawerBody className="flex flex-col gap-4">
          {/* showCollegeProgram={false}: those two free-text inputs had nowhere to go —
              `Testimonial` has no `college` column, and the program is captured properly
              by the picker below — so whatever staff typed there was discarded on save. */}
          <TestimonialInput
            value={form}
            onChange={setForm}
            showCollegeProgram={false}
            data-testid="testimonial-core-input"
          />
          <Select label="Program (optional)" placeholder="No program" value={programId} onValueChange={setProgramId} data-testid="testimonial-program-select">
            {(programs?.items ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </Select>
          <div className="flex items-end gap-3">
            <div className="flex flex-1 items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <div>
                <p id="testimonial-on-website-label" className="text-sm font-medium text-fg">
                  Show on website
                </p>
                <p className="text-xs text-fg-muted">
                  {onWebsite
                    ? "Appears in “What Our Students Say” on the homepage."
                    : "Hidden from the public site."}
                </p>
              </div>
              <Switch
                checked={onWebsite}
                onCheckedChange={setOnWebsite}
                aria-labelledby="testimonial-on-website-label"
                data-testid="testimonial-on-website-switch"
              />
            </div>
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
        toast({ title: "Review deleted", variant: "success" });
        setDeleteId(null);
      },
      onError: (error) => {
        surfaceError(toast, error, "Couldn't delete this review");
        setDeleteId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<Testimonial>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    { id: "quote", header: "Quote", cell: (row) => <span className="line-clamp-1">{row.quote}</span> },
    { id: "rating", header: "Rating", cell: (row) => (row.rating ? `${(row.rating / 10).toFixed(1)} ★` : "-") },
    {
      id: "status",
      header: "On website",
      // Mirrors the drawer's toggle rather than echoing the raw ContentStatus: what staff
      // need at a glance is "is this visible to visitors", and draft/archived answer that
      // identically.
      cell: (row) =>
        row.status === "published" ? (
          <StatusChip tone="success" label="Live" size="sm" />
        ) : (
          <StatusChip tone="neutral" label="Hidden" size="sm" />
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            aria-label={`Delete review from ${row.studentName}`}
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
        title="Couldn't load reviews"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="testimonials-manager">
      <PageHeader
        title="Reviews"
        description={
          <>
            Student reviews shown in the &quot;What Our Students Say&quot; section on the homepage. Turn on
            &quot;Show on website&quot; to publish one. The section is hidden entirely while none are live.
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
            New review
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
        emptyState={{ title: "No reviews yet", description: "Add your first student review." }}
        caption="Reviews"
        data-testid="testimonials-table"
      />

      <TestimonialFormDrawer open={formOpen} onOpenChange={setFormOpen} testimonial={editing} />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this review?"
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
