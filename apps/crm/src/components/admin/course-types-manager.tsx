// Admin ▸ Course types — the screen that replaced a hardcoded enum
// (docs/specs/course-types.md, ADR-0068).
//
// The list every course-type dropdown in the CRM reads. Staff add, rename, reorder and hide
// options here with no deploy; before this screen existed, changing "B.Tech / Degree /
// Diploma / MCA / MBA" meant a database migration, a contract change, four copies of a
// hardcoded array and a release.
//
// THREE THINGS THIS SCREEN IS DELIBERATE ABOUT:
//   1. HIDE beats DELETE. Hiding stops an option being offered on new records and leaves
//      every existing student exactly as they were recorded. It is what people actually
//      want when a course stops being sold, so it is the primary action, and delete is
//      refused by the API while anyone holds the key.
//   2. RENAMING IS SAFE, and the screen says so. The stored key never moves, so a rename
//      updates every screen, export and report at once without touching a student row.
//   3. THE COUNT IS ON EVERY ROW. "3 students" next to an option is what makes hiding and
//      deleting comprehensible decisions rather than guesses.
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  EmptyState,
  Input,
  PageHeader,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { CourseTypeOption, MeResponse } from "@repo/types";
import { slugifyCourseTypeKey } from "@repo/types";

import {
  useCourseTypesList,
  useCreateCourseType,
  useDeleteCourseType,
  useUpdateCourseType,
} from "../../hooks/use-course-types";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

export function CourseTypesManager({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  const { toast } = useToast();
  const canManage = hasPermission(me?.permissions, "course_types.manage");

  const { data, isLoading, isError, refetch } = useCourseTypesList();
  const createCourseType = useCreateCourseType();
  const updateCourseType = useUpdateCourseType();
  const deleteCourseType = useDeleteCourseType();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CourseTypeOption | null>(null);
  const [deleting, setDeleting] = React.useState<CourseTypeOption | null>(null);

  const rows = data?.items ?? [];

  function toggleActive(row: CourseTypeOption): void {
    updateCourseType.mutate(
      { id: row.id, body: { active: !row.active } },
      {
        onSuccess: () =>
          toast({
            title: row.active ? `“${row.label}” is hidden` : `“${row.label}” is back`,
            description: row.active
              ? "It is no longer offered on new records. Existing students keep it."
              : "It appears in the course-type pickers again.",
            variant: "success",
          }),
        onError: (error) => surfaceError(toast, error, "Couldn't update this course type"),
      },
    );
  }

  function handleDelete(): void {
    if (!deleting) return;
    deleteCourseType.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: `“${deleting.label}” deleted`, variant: "success" });
        setDeleting(null);
      },
      onError: (error) => {
        // The API refuses (409) when students hold the key, and its message names the
        // count and points at hiding — surface it rather than a generic failure.
        surfaceError(toast, error, "Couldn't delete this course type");
        setDeleting(null);
      },
    });
  }

  const columns: Array<DataTableColumn<CourseTypeOption>> = [
    { id: "label", header: "Course type", cell: (row) => row.label },
    {
      id: "students",
      header: "Students",
      align: "right",
      cell: (row) => (row.studentCount > 0 ? row.studentCount : "-"),
    },
    { id: "sortOrder", header: "Order", align: "right", cell: (row) => row.sortOrder },
    {
      id: "active",
      header: "Shown",
      cell: (row) => (
        <StatusChip
          tone={row.active ? "success" : "neutral"}
          label={row.active ? "Shown" : "Hidden"}
          size="sm"
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) =>
        canManage ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                toggleActive(row);
              }}
              data-testid={`toggle-course-type-${row.id}`}
            >
              {row.active ? "Hide" : "Show"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setDeleting(row);
              }}
              aria-label={`Delete ${row.label}`}
              data-testid={`delete-course-type-${row.id}`}
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
        title="Couldn't load course types"
        data-testid="course-types-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="course-types-manager">
      <PageHeader
        title="Course types"
        description="The qualifications offered in every course-type dropdown — on the student form, the registration step and lead conversion."
      />

      <Alert tone="neutral" title="Renaming is safe" data-testid="course-types-rename-note">
        Renaming a course type updates every screen, export and report at once, and does not
        change which students are in it. To retire one, <strong>hide</strong> it: it stops being
        offered on new records and the students already recorded with it keep their answer.
      </Alert>

      <div className="flex items-center justify-end">
        {canManage ? (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="course-type-create-button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New course type
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
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
          title: "No course types yet",
          description:
            "Add the qualifications you recruit for. Until then, the course-type dropdown on the student form has nothing to offer.",
        }}
        caption="Course types"
        data-testid="course-types-table"
      />

      <CourseTypeFormDrawer
        open={formOpen}
        onOpenChange={setFormOpen}
        courseType={editing}
        onCreate={(label, done) =>
          createCourseType.mutate(
            { label, active: true },
            {
              onSuccess: () => {
                toast({ title: `“${label}” added`, variant: "success" });
                done();
              },
              onError: (error) => surfaceError(toast, error, "Couldn't add this course type"),
            },
          )
        }
        onRename={(id, label, sortOrder, done) =>
          updateCourseType.mutate(
            { id, body: { label, sortOrder } },
            {
              onSuccess: () => {
                toast({ title: "Course type updated", variant: "success" });
                done();
              },
              onError: (error) => surfaceError(toast, error, "Couldn't update this course type"),
            },
          )
        }
        saving={createCourseType.isPending || updateCourseType.isPending}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete “${deleting.label}”?` : "Delete this course type?"}
        description={
          deleting && deleting.studentCount > 0
            ? `${deleting.studentCount} student${deleting.studentCount === 1 ? " is" : "s are"} recorded as “${deleting.label}”, so this cannot be deleted. Hide it instead.`
            : "It disappears from every course-type dropdown. No student is recorded with it, so nothing else changes."
        }
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteCourseType.isPending}
        data-testid="confirm-delete-course-type"
      />
    </div>
  );
}

interface CourseTypeFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseType: CourseTypeOption | null;
  onCreate: (label: string, done: () => void) => void;
  onRename: (id: string, label: string, sortOrder: number, done: () => void) => void;
  saving: boolean;
}

function CourseTypeFormDrawer({
  open,
  onOpenChange,
  courseType,
  onCreate,
  onRename,
  saving,
}: CourseTypeFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(courseType);
  const [label, setLabel] = React.useState("");
  const [sortOrder, setSortOrder] = React.useState("0");

  React.useEffect(() => {
    if (!open) return;
    setLabel(courseType?.label ?? "");
    setSortOrder(String(courseType?.sortOrder ?? 0));
  }, [open, courseType]);

  const trimmed = label.trim();
  // Previewed, not editable: the key is what student records store, so the screen shows
  // what will be written rather than letting someone set a second name for the same thing.
  const previewKey = slugifyCourseTypeKey(trimmed);
  const labelError = trimmed.length === 0 ? "Enter a name" : previewKey ? undefined : "Use a name with at least one letter or number";

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (labelError) return;
    const done = (): void => onOpenChange(false);
    if (courseType) {
      onRename(courseType.id, trimmed, Number(sortOrder) || 0, done);
    } else {
      onCreate(trimmed, done);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        title={isEdit ? "Edit course type" : "New course type"}
        description={
          isEdit
            ? "Renaming updates every screen at once. Students keep the course type they are recorded with."
            : "This appears in every course-type dropdown straight away."
        }
        data-testid="course-type-form-drawer"
      >
        <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Name"
              required
              placeholder="e.g. B.Sc Nursing"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              error={labelError}
              helperText={
                isEdit
                  ? `Stored as “${courseType?.key}” — that never changes, so renaming is safe.`
                  : previewKey
                    ? `Will be stored as “${previewKey}”.`
                    : undefined
              }
              data-testid="course-type-form-label"
            />
            {isEdit ? (
              <Input
                label="Order"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                helperText="Lower numbers appear first in the dropdowns."
                data-testid="course-type-form-sort-order"
              />
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} data-testid="course-type-form-submit">
              {isEdit ? "Save changes" : "Add course type"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
