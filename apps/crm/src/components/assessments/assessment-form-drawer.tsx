// Assessment authoring drawer — RHF + zod (CreateAssessmentRequest).
// Faculty create assessment + question bank (MCQ + descriptive).
// Answer keys are authored here (faculty/CRM only — NEVER sent to students).
// Permission: assessments.create (scope: assigned).
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
  CreateAssessmentRequestSchema,
  type AssessmentType,
  type CreateAssessmentRequest,
} from "@repo/types";
import type { z } from "zod";

import { useCreateAssessment, useUpdateAssessment } from "../../hooks/use-assessments";

const ASSESSMENT_TYPES: { value: AssessmentType; label: string }[] = [
  { value: "quiz", label: "Quiz" },
  { value: "test", label: "Test" },
];


interface AssessmentFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssessmentFormDrawer({
  open,
  onOpenChange,
}: AssessmentFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createAssessment = useCreateAssessment();
  const updateAssessment = useUpdateAssessment();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors },
  } = useForm<z.input<typeof CreateAssessmentRequestSchema>>({
    resolver: zodResolver(CreateAssessmentRequestSchema),
    defaultValues: {
      type: "quiz",
      passPct: 70,
      attemptsAllowed: 1,
      isRequired: false,
      shuffle: true,
      questions: [
        { type: "mcq", prompt: "", options: [{ id: "opt-a", text: "" }, { id: "opt-b", text: "" }], answerKey: "opt-a", points: 10, order: 0 },
      ],
    },
  });

  const { fields: questionFields, append: appendQuestion, remove: removeQuestion } = useFieldArray({
    control,
    name: "questions",
  });

  React.useEffect(() => {
    if (!open) return;
    reset({
      type: "quiz",
      passPct: 70,
      attemptsAllowed: 1,
      isRequired: false,
      shuffle: true,
      questions: [
        { type: "mcq", prompt: "", options: [{ id: "opt-a", text: "" }, { id: "opt-b", text: "" }], answerKey: "opt-a", points: 10, order: 0 },
      ],
    });
  }, [open, reset]);

  const isPending = createAssessment.isPending || updateAssessment.isPending;
  const questions = watch("questions");

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createAssessment.mutateAsync(values as CreateAssessmentRequest);
      toast({ title: "Assessment created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't create assessment", description, variant: "destructive" });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Create assessment"
        description="Build a timed quiz or test with MCQ and descriptive questions."
        size="xl"
        data-testid="assessment-create-drawer"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            {/* Assessment metadata */}
            <Input
              label="Module ID"
              required
              placeholder="e.g. module_9f3ac2"
              {...register("moduleId")}
              error={errors.moduleId?.message}
              helperText="The module this assessment belongs to."
              data-testid="assessment-form-module-id"
            />
            <Input
              label="Title"
              required
              placeholder="e.g. Module 3 Quiz"
              {...register("title")}
              error={errors.title?.message}
              data-testid="assessment-form-title"
            />
            <div className="grid grid-cols-2 gap-3">
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select
                    label="Type"
                    required
                    placeholder="Select type"
                    value={field.value}
                    onValueChange={(v) => field.onChange(v as AssessmentType)}
                    error={errors.type?.message}
                    data-testid="assessment-form-type"
                  >
                    {ASSESSMENT_TYPES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </Select>
                )}
              />
              <Input
                label="Pass threshold (%)"
                type="number"
                min={0}
                max={100}
                required
                placeholder="e.g. 70"
                {...register("passPct", { valueAsNumber: true })}
                error={errors.passPct?.message}
                helperText="% of total points required to pass."
                data-testid="assessment-form-pass-pct"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Time limit (seconds)"
                type="number"
                min={60}
                max={14400}
                placeholder="e.g. 1800"
                {...register("timeLimitS", { valueAsNumber: true, setValueAs: (v: string) => v === "" ? null : Number(v) })}
                error={errors.timeLimitS?.message}
                helperText="Leave blank for untimed."
                data-testid="assessment-form-time-limit"
              />
              <Input
                label="Max attempts"
                type="number"
                min={1}
                max={10}
                required
                placeholder="e.g. 1"
                {...register("attemptsAllowed", { valueAsNumber: true })}
                error={errors.attemptsAllowed?.message}
                data-testid="assessment-form-attempts-allowed"
              />
            </div>
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Controller
                  control={control}
                  name="isRequired"
                  render={({ field }) => (
                    <Checkbox
                      id="assessment-form-is-required"
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      data-testid="assessment-form-is-required"
                    />
                  )}
                />
                <Label htmlFor="assessment-form-is-required">Required for certificate eligibility</Label>
              </div>
              <div className="flex items-center gap-2">
                <Controller
                  control={control}
                  name="shuffle"
                  render={({ field }) => (
                    <Checkbox
                      id="assessment-form-shuffle"
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      data-testid="assessment-form-shuffle"
                    />
                  )}
                />
                <Label htmlFor="assessment-form-shuffle">Shuffle question order</Label>
              </div>
            </div>

            {/* Question bank */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-fg">Questions ({questionFields.length})</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      appendQuestion({
                        type: "mcq",
                        prompt: "",
                        options: [{ id: "opt-a", text: "" }, { id: "opt-b", text: "" }],
                        answerKey: "opt-a",
                        points: 10,
                        order: questionFields.length,
                      })
                    }
                    data-testid="add-mcq-question-button"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    MCQ
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      appendQuestion({
                        type: "descriptive",
                        prompt: "",
                        options: undefined,
                        answerKey: null,
                        points: 10,
                        order: questionFields.length,
                      })
                    }
                    data-testid="add-descriptive-question-button"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Descriptive
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {questionFields.map((field, index) => {
                  const qType = questions[index]?.type ?? "mcq";
                  return (
                    <fieldset
                      key={field.id}
                      className="flex flex-col gap-3 rounded-md border border-border p-4"
                    >
                      <legend className="px-1 text-sm font-medium text-fg">
                        Question {index + 1} —{" "}
                        {qType === "mcq" ? "Multiple choice" : "Descriptive"}
                      </legend>

                      <div className="flex items-start gap-2">
                        <div className="flex-1 flex flex-col gap-3">
                          <Textarea
                            label="Prompt"
                            required
                            id={`question-${index}-prompt`}
                            rows={2}
                            {...register(`questions.${index}.prompt`)}
                            placeholder="Enter the question…"
                            data-testid={`question-${index}-prompt`}
                          />

                          {qType === "mcq" ? (
                            <div className="flex flex-col gap-2">
                              <p className="text-xs font-medium text-fg-muted">Answer choices</p>
                              {["opt-a", "opt-b", "opt-c", "opt-d"].map((optId, optIndex) => (
                                <div key={optId} className="flex items-center gap-2">
                                  <input
                                    id={`q${index}-opt-${optId}-correct`}
                                    type="radio"
                                    value={optId}
                                    {...register(`questions.${index}.answerKey`)}
                                    className="size-4 border border-border focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={`Mark option ${optId} as correct answer`}
                                    data-testid={`question-${index}-answer-${optId}`}
                                  />
                                  <Input
                                    aria-label={`Option ${optId} text`}
                                    placeholder={`Option ${String.fromCharCode(65 + optIndex)}`}
                                    {...register(`questions.${index}.options.${optIndex}.text`)}
                                    wrapperClassName="flex-1"
                                    data-testid={`question-${index}-option-${optId}-text`}
                                  />
                                </div>
                              ))}
                              <p className="text-xs text-fg-muted">
                                Select the radio button next to the correct answer.
                              </p>
                            </div>
                          ) : (
                            <Textarea
                              label="Grading rubric notes (faculty reference — not shown to students)"
                              id={`question-${index}-rubric`}
                              rows={2}
                              {...register(`questions.${index}.answerKey` as `questions.0.answerKey`)}
                              placeholder="e.g. Mention key concepts: X, Y, Z. Award full marks for…"
                              data-testid={`question-${index}-rubric-notes`}
                            />
                          )}

                          <Input
                            label="Points"
                            type="number"
                            min={1}
                            max={100}
                            required
                            placeholder="e.g. 10"
                            {...register(`questions.${index}.points`, { valueAsNumber: true })}
                            wrapperClassName="w-28"
                            data-testid={`question-${index}-points`}
                          />
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove question ${index + 1}`}
                          onClick={() => removeQuestion(index)}
                          data-testid={`question-remove-${index}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            </div>
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              data-testid="assessment-form-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="assessment-form-submit">
              Create assessment
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
