// Assignment / Project authoring form drawer — RHF + zod (CreateAssignmentRequest).
// Faculty create/edit an assignment on a lesson within their assigned batches.
// Permission: assignments.create / assignments.edit (scope: assigned).
//
// WHERE IT ATTACHES. `assignments.lesson_id` is a required FK, so every assignment and
// every project hangs off ONE lesson. This form used to ask for that lesson as a raw uuid
// typed into a text box ("e.g. lesson_2f9c1a"), which is not something a human knows — in
// practice it meant opening the curriculum builder, copying an id, and coming back. So the
// field is now a CASCADE: pick the course, then pick one of its lessons. Two reads
// (`GET /crm/courses`, `GET /crm/courses/:id/curriculum`) that already existed for the
// curriculum builder; no new endpoint, and the id never has to be seen.
//
// The course select is the thing staff actually think in ("this case study belongs to the
// Neurology course"); the lesson select is scoped to it, so an id from the wrong course
// cannot be entered at all — a class of mistake the free-text field allowed silently.
import * as React from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  Label,
  Select,
  SelectItem,
  Textarea,
  useToast,
} from "@repo/ui";
import {
  CreateAssignmentRequestSchema,
  type AssignmentDetail,
  type AssignmentKind,
  type CreateAssignmentRequest,
} from "@repo/types";
import type { z } from "zod";

import { useCreateAssignment, useUpdateAssignment } from "../../hooks/use-assignments";
import { useCurriculum, useProgramsList } from "../../hooks/use-courses";

const KIND_OPTIONS: { value: AssignmentKind; label: string; description: string }[] = [
  { value: "assignment", label: "Assignment", description: "Single-submission assignment" },
  { value: "project", label: "Project", description: "Multi-milestone project (gates certificate)" },
];

/** Enough for every catalog this product has; the picker is a dropdown, not a directory. */
const COURSE_PAGE_SIZE = 100;

/**
 * `<input type="datetime-local">` → the ISO-8601-with-offset string the DTO requires.
 *
 * The browser emits `2026-07-09T10:30` (local, no seconds, no zone) and `""` when the field
 * is untouched. `dueAt` is `z.string().datetime({ offset: true }).optional()`, which rejects
 * BOTH — so before this, the form could not be submitted with a due date OR without one:
 * the empty string failed the same rule the filled value did. Normalising ahead of the
 * resolver (see `assignmentFormResolver`) is what makes the field actually optional.
 */
function toIsoDateTime(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = new Date(value);
  // Leave garbage alone rather than coercing it — zod then reports it under the field,
  // which is the honest outcome for a value the browser should never have produced.
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * The inverse, for edit mode: an ISO instant → the `YYYY-MM-DDTHH:mm` a datetime-local input
 * can actually display.
 *
 * Without this the control renders BLANK for a stored deadline (it rejects the trailing Z),
 * and submitting an untouched form then read that blank as "no deadline" — so editing a
 * project's title silently cleared its due date.
 */
function toDateTimeLocalValue(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  // Shift by the local offset so the wall-clock time shown matches the stored instant.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface AssignmentFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill for edit mode. */
  assignment?: AssignmentDetail;
  /** Pre-fill when creating from a specific lesson context. */
  lessonId?: string;
  /**
   * Fix the kind and hide the Kind picker — used by the Projects screen, where "add" can
   * only ever mean a project. Offering a choice there would let staff create an ordinary
   * assignment from a page that then cannot show it.
   */
  lockedKind?: AssignmentKind;
}

// Use the zod input type (before transform/defaults) so zodResolver infers correctly.
// Fields with .default() (kind, allowResubmit, isFinal) are optional in the input shape.
type FormValues = z.input<typeof CreateAssignmentRequestSchema>;

const zodAssignmentResolver = zodResolver(CreateAssignmentRequestSchema);

/**
 * The real resolver: normalise every datetime-local value to ISO, THEN validate.
 *
 * This is a wrapper rather than per-field `setValueAs` because the values reach the form by
 * two routes — typed into the control, or `reset()` from an existing assignment — and only a
 * wrapper covers both. The DOM value stays the local string the input can display; the DTO
 * gets the instant it requires.
 */
const assignmentFormResolver: typeof zodAssignmentResolver = (values, context, options) =>
  zodAssignmentResolver(
    {
      ...values,
      dueAt: toIsoDateTime(values.dueAt),
      ...(Array.isArray(values.milestones)
        ? { milestones: values.milestones.map((m) => ({ ...m, dueAt: toIsoDateTime(m?.dueAt) })) }
        : {}),
    },
    context,
    options,
  );

export function AssignmentFormDrawer({
  open,
  onOpenChange,
  assignment,
  lessonId,
  lockedKind,
}: AssignmentFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(assignment);
  const { toast } = useToast();
  const createAssignment = useCreateAssignment();
  const updateAssignment = useUpdateAssignment();

  // The course half of the lesson cascade. Local state, not a form field: the API takes a
  // lessonId and the course is only how a human navigates to one.
  const [courseId, setCourseId] = React.useState<string | undefined>(undefined);
  // Both reads are gated on the drawer being open (and, for the curriculum, on a chosen
  // course) so merely rendering the parent screen costs nothing.
  const coursesQuery = useProgramsList(
    { page: 1, pageSize: COURSE_PAGE_SIZE, includeDeleted: false },
    { enabled: open && !isEdit },
  );
  const curriculumQuery = useCurriculum(open && !isEdit && courseId ? courseId : undefined);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: assignmentFormResolver,
    defaultValues: {
      kind: lockedKind ?? "assignment",
      allowResubmit: false,
      isFinal: false,
      milestones: [],
      maxScore: 100,
    },
  });

  const { fields: milestoneFields, append: appendMilestone, remove: removeMilestone } = useFieldArray({
    control,
    name: "milestones",
  });

  const kind = watch("kind");
  const selectedLessonId = watch("lessonId");

  /**
   * The chosen course's lessons, flattened module-first into the order they are taught.
   * Each option carries its module title so "Week 1 · Intro" and "Week 4 · Intro" are
   * distinguishable — lesson titles repeat across modules far more often than staff expect.
   */
  const lessonOptions = React.useMemo(
    () =>
      (curriculumQuery.data?.modules ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .flatMap((module) =>
          module.lessons
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((lesson) => ({ id: lesson.id, label: `${module.title} · ${lesson.title}` })),
        ),
    [curriculumQuery.data],
  );

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && assignment) {
      reset({
        lessonId: assignment.lessonId,
        kind: assignment.kind,
        title: assignment.title,
        instructions: assignment.instructions ?? "",
        maxScore: assignment.maxScore,
        dueAt: toDateTimeLocalValue(assignment.dueAt),
        allowResubmit: assignment.allowResubmit,
        isFinal: assignment.isFinal,
        milestones: assignment.milestones.map((m) => ({
          title: m.title,
          order: m.order,
          dueAt: toDateTimeLocalValue(m.dueAt),
        })),
      });
    } else {
      setCourseId(undefined);
      reset({
        lessonId: lessonId ?? "",
        kind: lockedKind ?? "assignment",
        allowResubmit: false,
        isFinal: false,
        milestones: [],
        maxScore: 100,
      });
    }
  }, [open, isEdit, assignment, lessonId, lockedKind, reset]);

  // Switching course invalidates any lesson already picked — keeping it would submit a
  // lesson from the previous course, which the dropdown no longer even shows.
  React.useEffect(() => {
    if (isEdit) return;
    setValue("lessonId", "");
  }, [courseId, isEdit, setValue]);

  const isPending = createAssignment.isPending || updateAssignment.isPending;
  /** What this drawer is creating, in the words of the screen that opened it. */
  const noun = (lockedKind ?? assignment?.kind) === "project" ? "project" : "assignment";

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && assignment) {
        await updateAssignment.mutateAsync({
          id: assignment.id,
          body: {
            title: values.title,
            instructions: values.instructions,
            maxScore: values.maxScore,
            dueAt: values.dueAt ?? null,
            allowResubmit: values.allowResubmit,
            isFinal: values.isFinal,
          },
        });
        toast({ title: noun === "project" ? "Project updated" : "Assignment updated", variant: "success" });
      } else {
        await createAssignment.mutateAsync(values as CreateAssignmentRequest);
        toast({ title: noun === "project" ? "Project created" : "Assignment created", variant: "success" });
      }
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({
        title: isEdit ? `Couldn't update ${noun}` : `Couldn't create ${noun}`,
        description,
        variant: "destructive",
      });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={isEdit ? `Edit ${noun}` : `Create ${noun}`}
        description={
          isEdit
            ? assignment?.title
            : lockedKind === "project"
              ? "A multi-milestone project (case study). Pick the course it belongs to, then the lesson it hangs off."
              : "Attach an assignment or project to a lesson in your assigned batches."
        }
        size="lg"
        data-testid={isEdit ? "assignment-edit-drawer" : "assignment-create-drawer"}
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            {!isEdit ? (
              <>
                <Select
                  label="Course"
                  required
                  placeholder={coursesQuery.isLoading ? "Loading courses…" : "Choose a course"}
                  value={courseId}
                  onValueChange={setCourseId}
                  helperText={
                    coursesQuery.isError
                      ? "Couldn't load the course list — reopen this form to retry."
                      : "Which course this belongs to. Pick it first; the lessons below follow."
                  }
                  data-testid="assignment-form-course"
                >
                  {(coursesQuery.data?.items ?? []).map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.status === "published" ? course.title : `${course.title} (${course.status})`}
                    </SelectItem>
                  ))}
                </Select>

                {/* `lessonId` is what the API takes; the Select writes it through RHF so
                    zod's required-uuid rule still guards the submit. */}
                <Select
                  label="Lesson"
                  required
                  disabled={!courseId || curriculumQuery.isLoading}
                  placeholder={
                    !courseId
                      ? "Choose a course first"
                      : curriculumQuery.isLoading
                        ? "Loading lessons…"
                        : lessonOptions.length === 0
                          ? "This course has no lessons yet"
                          : "Choose a lesson"
                  }
                  value={selectedLessonId || undefined}
                  onValueChange={(value) => setValue("lessonId", value, { shouldValidate: true })}
                  error={errors.lessonId?.message}
                  helperText={
                    courseId && !curriculumQuery.isLoading && lessonOptions.length === 0
                      ? "Add a lesson to this course under Courses ▸ Curriculum first — every project has to hang off one."
                      : "The lesson this is attached to. Students reach it from there."
                  }
                  data-testid="assignment-form-lesson-id"
                >
                  {lessonOptions.map((lesson) => (
                    <SelectItem key={lesson.id} value={lesson.id}>
                      {lesson.label}
                    </SelectItem>
                  ))}
                </Select>

                {!lockedKind ? (
                  <Select
                    label="Kind"
                    required
                    placeholder="Select kind"
                    value={kind}
                    onValueChange={(value) => setValue("kind", value as AssignmentKind)}
                    error={errors.kind?.message}
                    data-testid="assignment-form-kind"
                  >
                    {KIND_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label} — {opt.description}
                      </SelectItem>
                    ))}
                  </Select>
                ) : null}
              </>
            ) : null}

            <Input
              label="Title"
              required
              placeholder="e.g. Build a REST API"
              {...register("title")}
              error={errors.title?.message}
              data-testid="assignment-form-title"
            />

            <Textarea
              label="Instructions"
              id="assignment-form-instructions"
              rows={5}
              {...register("instructions")}
              placeholder="Describe what students need to do…"
              data-testid="assignment-form-instructions"
            />

            <Input
              label="Max score (points)"
              type="number"
              min={1}
              max={10000}
              required
              placeholder="e.g. 100"
              {...register("maxScore", { valueAsNumber: true })}
              error={errors.maxScore?.message}
              data-testid="assignment-form-max-score"
            />

            <Input
              label="Due date"
              type="datetime-local"
              placeholder="e.g. 2026-07-09T10:30"
              helperText="Leave blank for no deadline."
              {...register("dueAt")}
              error={errors.dueAt?.message}
              data-testid="assignment-form-due-at"
            />

            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="allowResubmit"
                render={({ field }) => (
                  <Checkbox
                    id="assignment-form-allow-resubmit"
                    checked={field.value ?? false}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    data-testid="assignment-form-allow-resubmit"
                  />
                )}
              />
              <Label htmlFor="assignment-form-allow-resubmit">Allow resubmission after grading</Label>
            </div>

            {kind === "project" ? (
              <div className="flex items-center gap-2">
                <Controller
                  control={control}
                  name="isFinal"
                  render={({ field }) => (
                    <Checkbox
                      id="assignment-form-is-final"
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      data-testid="assignment-form-is-final"
                    />
                  )}
                />
                <Label htmlFor="assignment-form-is-final">This is the final project (gates certificate eligibility)</Label>
              </div>
            ) : null}

            {kind === "project" && !isEdit ? (
              <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium text-fg">
                  Milestones
                  <span className="ml-1 text-xs font-normal text-fg-muted">(optional)</span>
                </legend>
                {milestoneFields.map((field, index) => (
                  <div key={field.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 flex flex-col gap-2">
                        <Input
                          label={`Milestone ${index + 1} title`}
                          required
                          placeholder="e.g. Setup database schema"
                          {...register(`milestones.${index}.title`)}
                          data-testid={`milestone-title-${index}`}
                        />
                        <Input
                          label="Due date"
                          type="datetime-local"
                          placeholder="e.g. 2026-07-09T10:30"
                          {...register(`milestones.${index}.dueAt`)}
                          error={errors.milestones?.[index]?.dueAt?.message}
                          data-testid={`milestone-due-${index}`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove milestone ${index + 1}`}
                        onClick={() => removeMilestone(index)}
                        className="mt-6"
                        data-testid={`milestone-remove-${index}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    appendMilestone({ title: "", order: milestoneFields.length, dueAt: undefined })
                  }
                  data-testid="add-milestone-button"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add milestone
                </Button>
              </fieldset>
            ) : null}
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              data-testid="assignment-form-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="assignment-form-submit">
              {isEdit ? "Save changes" : `Create ${noun}`}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
