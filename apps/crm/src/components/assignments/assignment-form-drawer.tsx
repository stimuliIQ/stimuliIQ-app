// Assignment / Project authoring form drawer — RHF + zod (CreateAssignmentRequest).
// Faculty create/edit an assignment on a lesson within their assigned batches.
// Permission: assignments.create / assignments.edit (scope: assigned).
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

const KIND_OPTIONS: { value: AssignmentKind; label: string; description: string }[] = [
  { value: "assignment", label: "Assignment", description: "Single-submission assignment" },
  { value: "project", label: "Project", description: "Multi-milestone project (gates certificate)" },
];

interface AssignmentFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill for edit mode. */
  assignment?: AssignmentDetail;
  /** Pre-fill when creating from a specific lesson context. */
  lessonId?: string;
}

// Use the zod input type (before transform/defaults) so zodResolver infers correctly.
// Fields with .default() (kind, allowResubmit, isFinal) are optional in the input shape.
type FormValues = z.input<typeof CreateAssignmentRequestSchema>;

export function AssignmentFormDrawer({
  open,
  onOpenChange,
  assignment,
  lessonId,
}: AssignmentFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(assignment);
  const { toast } = useToast();
  const createAssignment = useCreateAssignment();
  const updateAssignment = useUpdateAssignment();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAssignmentRequestSchema),
    defaultValues: {
      kind: "assignment",
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

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && assignment) {
      reset({
        lessonId: assignment.lessonId,
        kind: assignment.kind,
        title: assignment.title,
        instructions: assignment.instructions ?? "",
        maxScore: assignment.maxScore,
        dueAt: assignment.dueAt ?? undefined,
        allowResubmit: assignment.allowResubmit,
        isFinal: assignment.isFinal,
        milestones: assignment.milestones.map((m) => ({
          title: m.title,
          order: m.order,
          dueAt: m.dueAt ?? undefined,
        })),
      });
    } else {
      reset({
        lessonId: lessonId ?? "",
        kind: "assignment",
        allowResubmit: false,
        isFinal: false,
        milestones: [],
        maxScore: 100,
      });
    }
  }, [open, isEdit, assignment, lessonId, reset]);

  const isPending = createAssignment.isPending || updateAssignment.isPending;

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
        toast({ title: "Assignment updated", variant: "success" });
      } else {
        await createAssignment.mutateAsync(values as CreateAssignmentRequest);
        toast({ title: "Assignment created", variant: "success" });
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
        title: isEdit ? "Couldn't update assignment" : "Couldn't create assignment",
        description,
        variant: "destructive",
      });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title={isEdit ? "Edit assignment" : "Create assignment"}
        description={
          isEdit
            ? assignment?.title
            : "Attach an assignment or project to a lesson in your assigned batches."
        }
        size="lg"
        data-testid={isEdit ? "assignment-edit-drawer" : "assignment-create-drawer"}
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            {!isEdit ? (
              <>
                <Input
                  label="Lesson ID"
                  required
                  placeholder="e.g. lesson_2f9c1a"
                  {...register("lessonId")}
                  error={errors.lessonId?.message}
                  helperText="The lesson this assignment is attached to."
                  data-testid="assignment-form-lesson-id"
                />
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
              {isEdit ? "Save changes" : "Create assignment"}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
