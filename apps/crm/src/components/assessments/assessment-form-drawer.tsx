// Assessment authoring drawer — RHF + zod (CreateAssessmentRequest).
// Faculty create assessment + question bank (MCQ + descriptive).
// Answer keys are authored here (faculty/CRM only — NEVER sent to students).
// Permission: assessments.create (scope: assigned).
//
// WHERE IT ATTACHES. `assessments.module_id` is a required FK, so every assessment hangs off
// ONE module. This form used to ask for that module as a raw uuid typed into a text box
// ("e.g. module_9f3ac2"), which is not something a human knows — in practice it meant opening
// the curriculum builder, copying an id, and coming back. So the field is now a CASCADE: pick
// the course, then pick one of its modules. Two reads (`GET /crm/courses`,
// `GET /crm/courses/:id/curriculum`) that already existed for the curriculum builder; no new
// endpoint, and the id never has to be seen.
//
// Deliberately the same shape as assignment-form-drawer.tsx's course→lesson cascade — the only
// difference is the depth it stops at (module here, lesson there), because that is what each
// API takes. Assessments were left on the raw-uuid field when assignments were converted.
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
import { useCurriculum, useProgramsList } from "../../hooks/use-courses";

const ASSESSMENT_TYPES: { value: AssessmentType; label: string }[] = [
  { value: "quiz", label: "Quiz" },
  { value: "test", label: "Test" },
];

/** Enough for every catalog this product has; the picker is a dropdown, not a directory. */
const COURSE_PAGE_SIZE = 100;

/**
 * The four MCQ choice slots the form always renders, and their stable ids.
 *
 * Rendering a fixed A–D is the UX decision; it is also why the payload needs normalising
 * before validation (see `assessmentFormResolver`). The ids are the contract with `answerKey`,
 * which stores one of these strings.
 */
const OPTION_IDS = ["opt-a", "opt-b", "opt-c", "opt-d"] as const;

/**
 * Turns what the four MCQ rows actually produce into what the DTO accepts.
 *
 * THE BUG THIS FIXES. The form renders four choice rows and registers
 * `questions.N.options.I.text` for each, but `defaultValues` only seeds TWO options (opt-a,
 * opt-b) and nothing ever writes `options[I].id`. So every submit carried two extra entries
 * shaped `{ text: "" }` — no `id`, empty `text` — and `McqOptionSchema` requires both. zod
 * rejected them at `questions.0.options.2.id`, a path with no field bound to it, so the error
 * rendered NOWHERE: the drawer just sat there on every click. Creating an MCQ assessment was
 * impossible, which is most of them.
 *
 * So: attach each row's stable id, and drop the rows the author left blank — C and D are
 * genuinely optional (the schema's floor is two). A descriptive question keeps no `options` at
 * all, including one switched over from MCQ, since `.strict()` rejects the leftover key.
 */
function normalizeQuestions(questions: unknown): unknown {
  if (!Array.isArray(questions)) return questions;
  return questions.map((question) => {
    const q = (question ?? {}) as Record<string, unknown>;
    if (q["type"] !== "mcq") {
      const { options: _dropped, ...rest } = q;
      return rest;
    }
    const rows = Array.isArray(q["options"]) ? q["options"] : [];
    const options = rows
      .map((row, index) => ({
        id: OPTION_IDS[index] ?? `opt-${index}`,
        text: typeof (row as { text?: unknown })?.text === "string" ? (row as { text: string }).text.trim() : "",
      }))
      .filter((option) => option.text !== "");
    return { ...q, options };
  });
}

/**
 * `<input type="number">` leaves an untouched field as `NaN`, which `z.number()` rejects even
 * though `timeLimitS` is `.nullable().optional()`.
 *
 * The field registered BOTH `valueAsNumber: true` and `setValueAs`; react-hook-form honours
 * `valueAsNumber` and ignores `setValueAs`, so the "" → null branch never ran and an untimed
 * assessment could not be submitted at all. Same shape of trap as the assignment form's
 * `dueAt`: the optional field failed the moment it was left alone.
 */
function normalizeTimeLimit(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  return typeof value === "number" && Number.isNaN(value) ? null : (value as number);
}

const zodAssessmentResolver = zodResolver(CreateAssessmentRequestSchema);

/**
 * Normalises the payload ahead of zod, for the two reasons documented above.
 *
 * A wrapper rather than per-field `setValueAs` because the option rows are a field ARRAY whose
 * shape (ids, blank rows) cannot be expressed per-input, and because the DOM values must stay
 * exactly what the controls can display.
 */
const assessmentFormResolver: typeof zodAssessmentResolver = (values, context, options) =>
  zodAssessmentResolver(
    {
      ...values,
      timeLimitS: normalizeTimeLimit((values as { timeLimitS?: unknown }).timeLimitS),
      questions: normalizeQuestions((values as { questions?: unknown }).questions),
    } as typeof values,
    context,
    options,
  );


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

  // The course half of the module cascade. Local state, not a form field: the API takes a
  // moduleId and the course is only how a human navigates to one.
  const [courseId, setCourseId] = React.useState<string | undefined>(undefined);
  // Both reads are gated on the drawer being open (and, for the curriculum, on a chosen
  // course) so merely rendering the parent screen costs nothing.
  const coursesQuery = useProgramsList(
    { page: 1, pageSize: COURSE_PAGE_SIZE, includeDeleted: false },
    { enabled: open },
  );
  const curriculumQuery = useCurriculum(open && courseId ? courseId : undefined);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<z.input<typeof CreateAssessmentRequestSchema>>({
    resolver: assessmentFormResolver,
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

  /**
   * The chosen course's modules, in the order they are taught. Unlike the lesson cascade this
   * needs no parent label to disambiguate — module titles are unique within a course in
   * practice, and there is no grandparent to qualify them with.
   */
  const moduleOptions = React.useMemo(
    () =>
      (curriculumQuery.data?.modules ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((module) => ({ id: module.id, label: module.title })),
    [curriculumQuery.data],
  );

  React.useEffect(() => {
    if (!open) return;
    setCourseId(undefined);
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

  // Switching course invalidates any module already picked — keeping it would submit a module
  // from the previous course, which the dropdown no longer even shows. That is the exact
  // cross-course mistake the raw-uuid field allowed silently, so the cascade must not
  // reintroduce it by holding a stale id.
  React.useEffect(() => {
    setValue("moduleId", "");
  }, [courseId, setValue]);

  const isPending = createAssessment.isPending || updateAssessment.isPending;
  const questions = watch("questions");
  const selectedModuleId = watch("moduleId");

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
            <Select
              label="Course"
              required
              placeholder={coursesQuery.isLoading ? "Loading courses…" : "Choose a course"}
              value={courseId}
              onValueChange={setCourseId}
              helperText={
                coursesQuery.isError
                  ? "Couldn't load the course list — reopen this form to retry."
                  : "Which course this belongs to. Pick it first; the modules below follow."
              }
              data-testid="assessment-form-course"
            >
              {(coursesQuery.data?.items ?? []).map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.status === "published" ? course.title : `${course.title} (${course.status})`}
                </SelectItem>
              ))}
            </Select>

            {/* `moduleId` is what the API takes; the Select writes it through RHF so zod's
                required-uuid rule still guards the submit. */}
            <Select
              label="Module"
              required
              disabled={!courseId || curriculumQuery.isLoading}
              placeholder={
                !courseId
                  ? "Choose a course first"
                  : curriculumQuery.isLoading
                    ? "Loading modules…"
                    : moduleOptions.length === 0
                      ? "This course has no modules yet"
                      : "Choose a module"
              }
              value={selectedModuleId || undefined}
              onValueChange={(value) => setValue("moduleId", value, { shouldValidate: true })}
              error={errors.moduleId?.message}
              helperText={
                courseId && !curriculumQuery.isLoading && moduleOptions.length === 0
                  ? "Add a module to this course under Courses ▸ Curriculum first — every assessment has to hang off one."
                  : "The module this assessment belongs to. Students reach it from there."
              }
              data-testid="assessment-form-module-id"
            >
              {moduleOptions.map((module) => (
                <SelectItem key={module.id} value={module.id}>
                  {module.label}
                </SelectItem>
              ))}
            </Select>
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
              {/* `setValueAs` only — NOT alongside `valueAsNumber`, which overrides it and turns
                  an untouched optional field into NaN. See `normalizeTimeLimit`. */}
              <Input
                label="Time limit (seconds)"
                type="number"
                min={60}
                max={14400}
                placeholder="e.g. 1800"
                {...register("timeLimitS", { setValueAs: (v: string) => (v === "" ? null : Number(v)) })}
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
                              {OPTION_IDS.map((optId, optIndex) => (
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
