// Descriptive attempt grade drawer — faculty manually grades descriptive
// question answers after student submission.
// PUT /crm/attempts/:id/grade → marks passed/failed per AC-D9.
// DOMPurify sanitization on student-submitted descriptive answer text (AC-J8).
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  EmptyState,
  Textarea,
  useToast,
} from "@repo/ui";
import { GradeAttemptRequestSchema, type AttemptResult, type GradeAttemptRequest } from "@repo/types";

import { useGradeAttempt } from "../../hooks/use-assessments";
import { queryErrorMessage } from "../../lib/surface-error";
// Note: sanitizeHtml is not used here because AttemptResult.questionResults doesn't
// include the raw student answer text — that lives server-side. If the API is extended
// to return answer text, wrap it with sanitizeHtml before dangerouslySetInnerHTML.

interface DescriptiveGradeDrawerProps {
  attempt: AttemptResult | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DescriptiveGradeDrawer({
  attempt,
  open,
  onOpenChange,
}: DescriptiveGradeDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const gradeAttempt = useGradeAttempt();

  // Build form values from pending descriptive questions
  const pendingDescriptiveQuestions = React.useMemo(() => {
    if (!attempt?.questionResults) return [];
    return attempt.questionResults.filter((q) => q.isPendingManualGrade);
  }, [attempt]);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<GradeAttemptRequest>({
    resolver: zodResolver(GradeAttemptRequestSchema),
    defaultValues: {
      questionGrades: [],
      passed: false,
    },
  });

  React.useEffect(() => {
    if (!open) return;
    reset({
      questionGrades: pendingDescriptiveQuestions.map((q) => ({
        questionId: q.questionId,
        earnedPoints: 0,
        feedback: "",
      })),
      passed: false,
    });
  }, [open, pendingDescriptiveQuestions, reset]);

  const isPending = gradeAttempt.isPending;

  // `passed` is unused outside submit (controller handles it)

  const onSubmit = handleSubmit(async (values) => {
    if (!attempt) return;
    try {
      await gradeAttempt.mutateAsync({ id: attempt.id, body: values });
      toast({ title: "Attempt graded", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description = queryErrorMessage(error);
      toast({ title: "Couldn't grade attempt", description, variant: "destructive" });
    }
  });

  // passed state managed via Controller below

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Grade descriptive attempt"
        description={
          attempt
            ? `Assessment: ${attempt.assessmentTitle}, Attempt #${attempt.attemptNo}`
            : undefined
        }
        size="lg"
        data-testid="descriptive-grade-drawer"
      >
        {!attempt ? (
          <DrawerBody>
            <EmptyState
              data-testid="descriptive-grade-empty"
              title="No attempt selected"
              description="Select an attempt from the grading queue."
            />
          </DrawerBody>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              {/* Attempt summary */}
              <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs text-fg-muted">Score so far (MCQ)</p>
                  <p className="text-sm font-medium text-fg">
                    {attempt.score ?? 0}/{attempt.totalPoints}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs text-fg-muted">Pass threshold</p>
                  <p className="text-sm font-medium text-fg">{attempt.passPct}%</p>
                </div>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs text-fg-muted">Tab switches</p>
                  <p className="text-sm font-medium text-fg">{attempt.flags.tabSwitchCount}</p>
                </div>
              </div>

              {pendingDescriptiveQuestions.length === 0 ? (
                <Alert tone="warning">No descriptive questions pending manual grade.</Alert>
              ) : (
                <div className="flex flex-col gap-4">
                  {pendingDescriptiveQuestions.map((q, index) => {
                    // Find the student's answer for this question
                    // Note: attempt.questionResults holds per-question scoring info
                    // The raw answer text isn't in AttemptResult; we show a placeholder
                    return (
                      <div
                        key={q.questionId}
                        className="flex flex-col gap-3 rounded-md border border-border p-4"
                        data-testid={`descriptive-question-${index}`}
                      >
                        <p className="text-sm font-medium text-fg">
                          Question {index + 1}, {q.maxPoints} pts max
                        </p>
                        <p className="text-xs text-fg-muted">
                          Student answer is stored server-side. Max points: {q.maxPoints}
                        </p>

                        <Input
                          label={`Points awarded (0–${q.maxPoints})`}
                          type="number"
                          min={0}
                          max={q.maxPoints}
                          required
                          placeholder={`e.g. ${q.maxPoints}`}
                          {...register(`questionGrades.${index}.earnedPoints`, { valueAsNumber: true })}
                          error={errors.questionGrades?.[index]?.earnedPoints?.message}
                          data-testid={`descriptive-points-${index}`}
                        />

                        <Textarea
                          label="Feedback"
                          id={`descriptive-feedback-${index}`}
                          rows={2}
                          {...register(`questionGrades.${index}.feedback`)}
                          placeholder="Optional feedback for this question…"
                          data-testid={`descriptive-feedback-${index}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pass/fail decision — controlled via Controller for boolean type safety */}
              <div className="flex flex-col gap-2 rounded-md border border-border p-4">
                <p className="text-sm font-medium text-fg">Final verdict</p>
                <p className="text-xs text-fg-muted">
                  Set whether this attempt passes the assessment (feeds certificate eligibility for required
                  assessments).
                </p>
                <Controller
                  control={control}
                  name="passed"
                  render={({ field }) => (
                    <div className="flex gap-3 mt-1" role="radiogroup" aria-label="Pass or fail verdict">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={field.name}
                          value="pass"
                          checked={field.value === true}
                          onChange={() => field.onChange(true)}
                          className="size-4 border border-border focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid="descriptive-grade-pass"
                        />
                        <span className="text-sm text-success font-medium">Pass</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={field.name}
                          value="fail"
                          checked={field.value === false}
                          onChange={() => field.onChange(false)}
                          className="size-4 border border-border focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid="descriptive-grade-fail"
                        />
                        <span className="text-sm text-danger font-medium">Fail</span>
                      </label>
                    </div>
                  )}
                />
              </div>
            </DrawerBody>
            <DrawerFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                data-testid="descriptive-grade-cancel"
              >
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="descriptive-grade-submit">
                Submit grade
              </Button>
            </DrawerFooter>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
