// Create/Edit student drawer — react-hook-form + zod resolver using the
// SAME schemas the backend validates against (CreateStudentRequestSchema /
// UpdateStudentRequestSchema from @repo/types), per CLAUDE.md §3.2 ("zod
// schemas reused FE+BE, single source of truth"). Pure form/presentation —
// the actual create/update calls live in hooks/use-students.ts.
//
// LIFECYCLE FLOW (lifecycle-redesign): "Add student" captures a CONTACT only —
// name/email/phone/course-interest — and always creates at status "lead" (no
// Status dropdown: staff picking "Active" by hand silently skipped the whole
// journey). Full details (college/year/city/alternate phone) belong to the
// REGISTRATION step (register-student-dialog.tsx), which the directory opens
// automatically right after the contact is created via `onCreated`.
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
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
import {
  CreateStudentRequestSchema,
  UpdateStudentRequestSchema,
  type CourseType,
  type StudentDetail,
  type StudentStatus,
} from "@repo/types";

// Use the schema's *input* type (pre-`.default()`) for the RHF generic —
// the inferred output type (CreateStudentRequest) makes `status` required,
// which breaks the zodResolver's input/output contract since the form may
// not have set it yet on first render.
type CreateStudentFormValues = z.input<typeof CreateStudentRequestSchema>;
type UpdateStudentFormValues = z.input<typeof UpdateStudentRequestSchema>;

import { useCreateStudent, useUpdateStudent } from "../../hooks/use-students";
import { errorCode, queryErrorMessage, surfaceError } from "../../lib/surface-error";
import { CourseTypeSelect } from "./course-type-select";
import {
  optionalE164Phone,
  phoneFieldProps,
  requireLocalPhones,
  toLocalPhoneDigits,
} from "../../lib/phone-field";

const PHONE_FIELDS = ["phone", "alternatePhone"] as const;

const STUDENT_STATUSES: { value: StudentStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "alumni", label: "Completed" },
];

// An untouched text input yields "", and an untouched number input yields NaN — neither
// is `undefined`, so the OPTIONAL fields below (phone/college/city/source/year) were
// validated as if the user had entered a value: a blank Phone failed `.regex(E.164)`,
// a blank College failed `.min(1)`, a blank Year failed "Expected number, received nan".
// The result was that no student could be created without filling every optional field.
// Normalise empty → undefined at the register() boundary so "left blank" means "omitted".
export const optionalText = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };
export const optionalNumber = {
  setValueAs: (value: unknown) => {
    if (value === "" || value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  },
};

interface StudentFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit mode; absent for create mode. */
  student?: StudentDetail;
  /**
   * Create mode: called with the new contact right after creation so the caller
   * can chain the registration step (lifecycle-redesign flow).
   */
  onCreated?: (student: StudentDetail) => void;
}

export function StudentFormDrawer({ open, onOpenChange, student, onCreated }: StudentFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(student);
  const { toast } = useToast();
  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();

  const createForm = useForm<CreateStudentFormValues>({
    resolver: zodResolver(requireLocalPhones(CreateStudentRequestSchema, PHONE_FIELDS)),
    defaultValues: { status: "lead" },
  });
  const updateForm = useForm<UpdateStudentFormValues>({
    resolver: zodResolver(requireLocalPhones(UpdateStudentRequestSchema, PHONE_FIELDS)),
  });

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && student) {
      updateForm.reset({
        name: student.name,
        // Stored E.164 → the 10 local digits the field is capped at.
        phone: toLocalPhoneDigits(student.phone) || undefined,
        alternatePhone: toLocalPhoneDigits(student.alternatePhone) || undefined,
        college: student.college ?? undefined,
        courseType: student.courseType,
        year: student.year ?? undefined,
        city: student.city ?? undefined,
        source: student.source ?? undefined,
        status: student.status,
      });
    } else {
      createForm.reset({ status: "lead" });
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, student]);

  const isPending = createStudent.isPending || updateStudent.isPending;

  const onSubmitCreate = createForm.handleSubmit(async (values) => {
    try {
      // Contacts ALWAYS enter the lifecycle at "lead" — registration (the next
      // step, auto-opened via onCreated) is what moves them to Registered.
      // Fields hold 10 local digits; the API and DB speak E.164.
      const body = CreateStudentRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        status: "lead",
      });
      const created = await createStudent.mutateAsync(body);
      toast({
        title: "Contact created",
        description: "Complete the registration to make them a student.",
        variant: "success",
      });
      onOpenChange(false);
      onCreated?.(created);
    } catch (error) {
      // A taken email is a problem with one FIELD, not the request as a whole —
      // pin it to the Email input (and keep the drawer open) so the fix is where
      // the mistake is, rather than in a toast that disappears.
      if (errorCode(error) === "students.email_in_use") {
        createForm.setError("email", { type: "server", message: queryErrorMessage(error) }, { shouldFocus: true });
        return;
      }
      surfaceError(toast, error, "Couldn't create student");
    }
  });

  const onSubmitUpdate = updateForm.handleSubmit(async (values) => {
    if (!student) return;
    try {
      const body = UpdateStudentRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        // `null` explicitly clears the alternate number — don't collapse it to "omitted".
        alternatePhone: values.alternatePhone === null ? null : optionalE164Phone(values.alternatePhone),
      });
      await updateStudent.mutateAsync({ id: student.id, body });
      toast({ title: "Student updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update student");
    }
  });

  if (isEdit) {
    const { register, formState, watch, setValue } = updateForm;
    const errors = formState.errors;
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent position="center" title="Edit student" description={student?.email} data-testid="student-edit-drawer">
          <form onSubmit={onSubmitUpdate} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input label="Full name" required placeholder="e.g. Priya Sharma" {...register("name")} error={errors.name?.message} data-testid="student-form-name" />
              <Input label="Phone" {...phoneFieldProps(register("phone", optionalText))} error={errors.phone?.message} data-testid="student-form-phone" />
              <Input
                label="Alternate phone"
                {...phoneFieldProps(register("alternatePhone", optionalText))}
                helperText="Guardian / secondary number"
                error={errors.alternatePhone?.message}
                data-testid="student-form-alternate-phone"
              />
              <Input label="College" placeholder="e.g. IIT Delhi" {...register("college", optionalText)} error={errors.college?.message} data-testid="student-form-college" />
              <CourseTypeSelect
                required
                value={watch("courseType")}
                onChange={(value) => setValue("courseType", value as CourseType, { shouldValidate: true })}
                error={errors.courseType?.message}
                data-testid="student-form-course-type"
              />
              <Input
                label="Year"
                type="number"
                min={1}
                max={8}
                placeholder="e.g. 3"
                {...register("year", optionalNumber)}
                error={errors.year?.message}
                data-testid="student-form-year"
              />
              <Input label="City" placeholder="e.g. Bengaluru" {...register("city", optionalText)} error={errors.city?.message} data-testid="student-form-city" />
              <Input label="Source" placeholder="e.g. Instagram, referral" {...register("source", optionalText)} error={errors.source?.message} data-testid="student-form-source" />
              <Select
                label="Status"
                required
                placeholder="Select status"
                value={watch("status")}
                onValueChange={(value) => setValue("status", value as StudentStatus, { shouldValidate: true })}
                error={errors.status?.message}
                data-testid="student-form-status"
              >
                {STUDENT_STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="student-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="student-form-submit">
                Save changes
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    );
  }

  const { register, formState, watch, setValue } = createForm;
  const errors = formState.errors;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        title="Add student contact"
        description="Step 1 of 2. Capture the contact. The registration form opens next."
        data-testid="student-create-drawer"
      >
        <form onSubmit={onSubmitCreate} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Full name" required placeholder="e.g. Priya Sharma" {...register("name")} error={errors.name?.message} data-testid="student-form-name" />
            <Input label="Email" type="email" required placeholder="name@example.com" {...register("email")} error={errors.email?.message} data-testid="student-form-email" />
            <Input label="Phone" {...phoneFieldProps(register("phone", optionalText))} error={errors.phone?.message} data-testid="student-form-phone" />
            <CourseTypeSelect
              required
              value={watch("courseType")}
              onChange={(value) => setValue("courseType", value as CourseType, { shouldValidate: true })}
              error={errors.courseType?.message}
              data-testid="student-form-course-type"
            />
            <Input label="Source" placeholder="e.g. Instagram, referral" {...register("source", optionalText)} error={errors.source?.message} data-testid="student-form-source" />
            <p className="text-xs text-fg-muted">
              New contacts start as <span className="font-medium">New Lead</span>. College, city and the remaining
              details are collected in the registration step that opens next.
            </p>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="student-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="student-form-submit">
              Create &amp; continue
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
