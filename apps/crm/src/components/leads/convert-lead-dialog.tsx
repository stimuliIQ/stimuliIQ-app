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
import { ZodError } from "zod";
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
  phone?: string;
  alternatePhone?: string;
  college?: string;
  year?: string;
  city?: string;
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
      // Prefill everything the lead already told us — conversion is the single
      // registration step now, so staff complete/correct the details here.
      reset({
        name: lead.name,
        email: lead.email ?? "",
        phone: lead.phone,
        college: lead.college ?? "",
      });
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
          phone: values.phone?.trim() || undefined,
          alternatePhone: values.alternatePhone?.trim() || undefined,
          college: values.college?.trim() || undefined,
          year: values.year?.trim() ? Number(values.year) : undefined,
          city: values.city?.trim() || undefined,
        },
        programId: values.programId || undefined,
        batchId: values.batchId || undefined,
        couponCode: values.couponCode || undefined,
      });
      const result = await convertLead.mutateAsync({ id: lead.id, body });
      toast({
        title: "Lead converted",
        description: "Student created — LMS credentials will be emailed once payment completes.",
        variant: "success",
      });
      onOpenChange(false);
      onConverted(result.studentId);
    } catch (error) {
      // Client-side contract violations (bad phone format, year out of range)
      // land on their own fields instead of the generic program error.
      if (error instanceof ZodError) {
        for (const issue of error.issues) {
          const field = issue.path[issue.path.length - 1];
          if (typeof field === "string") {
            setError(field as keyof ConvertFormValues, { message: issue.message });
          }
        }
        return;
      }
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
        size="lg"
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
                Conversion is the full registration — capture every student detail here; there is no separate
                registration step. LMS login credentials are emailed automatically once their payment completes.
                Optionally pick a program + batch to also create the order in the same atomic step.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  helperText="LMS credentials go here after payment completes."
                  {...register("email", { required: true })}
                  error={errors.email?.message}
                  data-testid="convert-lead-email"
                />
                <Input
                  label="Phone"
                  type="tel"
                  placeholder="+91XXXXXXXXXX"
                  {...register("phone")}
                  error={errors.phone?.message}
                  data-testid="convert-lead-phone"
                />
                <Input
                  label="Alternate / guardian phone"
                  type="tel"
                  placeholder="+91XXXXXXXXXX"
                  {...register("alternatePhone")}
                  error={errors.alternatePhone?.message}
                  data-testid="convert-lead-alternate-phone"
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
                <Input
                  label="Year of study"
                  type="number"
                  min={1}
                  max={8}
                  placeholder="e.g. 3"
                  {...register("year")}
                  error={errors.year?.message}
                  data-testid="convert-lead-year"
                />
                <Input
                  label="College / University"
                  placeholder="e.g. JNTU Hyderabad"
                  {...register("college")}
                  error={errors.college?.message}
                  data-testid="convert-lead-college"
                />
                <Input
                  label="City"
                  placeholder="e.g. Hyderabad"
                  {...register("city")}
                  error={errors.city?.message}
                  data-testid="convert-lead-city"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
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
              </div>
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
