// Convert-to-student drawer — RHF + zod resolver against
// ConvertLeadRequestSchema (@repo/types). Only actionable from a
// negotiation/won lead (lead-detail-drawer.tsx gates visibility; the
// backend is the real enforcement and returns 422/409 for an invalid stage
// or an already-converted lead — surfaced inline below, not just toasted,
// per the task brief: "Surface the backend's rules... as inline
// validation/errors").
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import { ConvertLeadRequestSchema, type ConvertLeadRequest, type CourseType, type LeadDetail } from "@repo/types";

import { useConvertLead } from "../../hooks/use-leads";
import { useProgramsList } from "../../hooks/use-courses";
import { useBatchesList } from "../../hooks/use-batches";

const COURSE_TYPES: { value: CourseType; label: string }[] = [
  { value: "btech", label: "B.Tech" },
  { value: "degree", label: "Degree" },
  { value: "diploma", label: "Diploma" },
  { value: "mca", label: "MCA" },
  { value: "mba", label: "MBA" },
  { value: "other", label: "Other" },
];

interface ConvertLeadDialogProps {
  lead: LeadDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted: (studentId: string) => void;
}

interface ConvertFormValues {
  name: string;
  email: string;
  courseType: CourseType;
  programId?: string;
  batchId?: string;
  couponCode?: string;
}

export function ConvertLeadDialog({ lead, open, onOpenChange, onConverted }: ConvertLeadDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const convertLead = useConvertLead();
  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });

  const { register, handleSubmit, reset, watch, setValue, formState, setError, clearErrors } = useForm<ConvertFormValues>();
  const errors = formState.errors;
  const programId = watch("programId");

  // Batches are scoped to the selected program — the order/enrollment the
  // backend creates on conversion requires a batch belonging to that program.
  const { data: batchesData } = useBatchesList({
    page: 1,
    pageSize: 200,
    programId: programId || undefined,
    includeDeleted: false,
  });

  React.useEffect(() => {
    if (open) {
      reset({ name: lead.name, email: lead.email ?? "" });
      clearErrors();
    }
  }, [open, lead, reset, clearErrors]);

  // Convert-from-any-stage (2026-07 redesign): a lead can be converted in one click from
  // any stage except `lost` (reopen it first). Conversion sets stage=won server-side.
  const isEligible = lead.stage !== "lost";
  const alreadyConverted = Boolean(lead.convertedStudentId);

  const onSubmit = handleSubmit(async (values) => {
    const hasProgram = Boolean(values.programId);
    const hasBatch = Boolean(values.batchId);
    if (hasProgram !== hasBatch) {
      setError(hasProgram ? "batchId" : "programId", {
        message: "Both program and batch are required together to create an order on conversion.",
      });
      return;
    }

    try {
      const body: ConvertLeadRequest = ConvertLeadRequestSchema.parse({
        studentFields: {
          name: values.name,
          email: values.email,
          courseType: values.courseType,
        },
        programId: values.programId || undefined,
        batchId: values.batchId || undefined,
        couponCode: values.couponCode || undefined,
      });
      const result = await convertLead.mutateAsync({ id: lead.id, body });
      toast({ title: "Lead converted", description: "The student record has been created.", variant: "success" });
      onOpenChange(false);
      onConverted(result.studentId);
    } catch (error) {
      const problem = error && typeof error === "object" && "problem" in error
        ? (error as { problem: { detail?: string; title?: string; status?: number } }).problem
        : undefined;
      // Surface backend rule violations inline (stage / already-converted /
      // programId+batchId both-or-neither) rather than only a toast, per the
      // task brief.
      setError("programId", { message: problem?.detail ?? problem?.title ?? "Conversion failed." });
      toast({
        title: "Couldn't convert this lead",
        description: problem?.detail ?? problem?.title,
        variant: "destructive",
      });
    }
  });

  const programs = programsData?.items ?? [];
  const batches = batchesData?.items ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Convert to student"
        description={lead.name}
        data-testid="convert-lead-drawer"
      >
        {!isEligible || alreadyConverted ? (
          <DrawerBody>
            <p className="text-sm text-fg-muted" data-testid="convert-lead-ineligible">
              {alreadyConverted
                ? "This lead has already been converted to a student."
                : "A lost lead can't be converted. Reopen it first, then convert."}
            </p>
          </DrawerBody>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <p className="text-xs text-fg-muted">
                Creates a student record from this lead. Optionally provide a program + batch to also create an order and
                enrollment in the same atomic step.
              </p>
              <Input
                label="Student name"
                placeholder="e.g. Priya Sharma"
                required
                {...register("name", { required: true })}
                error={errors.name?.message}
                data-testid="convert-lead-name"
              />
              <Input
                label="Email"
                type="email"
                placeholder="name@example.com"
                required
                {...register("email", { required: true })}
                error={errors.email?.message}
                data-testid="convert-lead-email"
              />
              <Select
                label="Course type"
                placeholder="Select course type"
                required
                value={watch("courseType")}
                onValueChange={(value) => setValue("courseType", value as CourseType)}
                error={errors.courseType?.message}
                data-testid="convert-lead-course-type"
              >
                {COURSE_TYPES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
              <Select
                label="Program (optional)"
                placeholder="No order — student only"
                value={programId}
                onValueChange={(value) => {
                  setValue("programId", value === "__none__" ? undefined : value);
                  setValue("batchId", undefined);
                }}
                helperText="Creating an order requires both program and batch."
                error={errors.programId?.message}
                data-testid="convert-lead-program"
              >
                <SelectItem value="__none__">No order — student only</SelectItem>
                {programs.map((program) => (
                  <SelectItem key={program.id} value={program.id}>
                    {program.title}
                  </SelectItem>
                ))}
              </Select>
              {programId ? (
                <Select
                  label="Batch"
                  placeholder="Select a batch"
                  value={watch("batchId")}
                  onValueChange={(value) => setValue("batchId", value)}
                  error={errors.batchId?.message}
                  data-testid="convert-lead-batch"
                >
                  {batches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.name}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              {programId ? (
                <Input
                  label="Coupon code (optional)"
                  placeholder="e.g. WELCOME10"
                  {...register("couponCode")}
                  data-testid="convert-lead-coupon"
                />
              ) : null}
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="convert-lead-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={convertLead.isPending} data-testid="convert-lead-submit">
                Convert
              </Button>
            </DrawerFooter>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}
