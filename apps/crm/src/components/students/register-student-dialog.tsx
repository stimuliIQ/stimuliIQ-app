// Register-student dialog (lifecycle-redesign, step 2 of the add-student flow):
// a lead-status CONTACT becomes a REGISTERED student. Collects the full record —
// verified name/phones (incl. alternate/guardian number), college, course type,
// year, city — and submits one PATCH with status:"active", which the derived
// lifecycle resolver reads as "Registered". Auto-opened by the directory right
// after contact creation; also reachable from the drawer's "Complete
// registration" action for contacts created earlier.
//
// On success the caller chains the NEXT lifecycle step (program assignment) via
// `onRegistered` — the whole Lead → Registered → Program → Payment flow runs in
// consecutive dialogs with zero page switches.
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
import { UpdateStudentRequestSchema, type CourseType, type StudentDetail } from "@repo/types";

import { useUpdateStudent } from "../../hooks/use-students";
import { surfaceError } from "../../lib/surface-error";
import { COURSE_TYPES, optionalText, optionalNumber } from "./student-form-drawer";
import {
  optionalE164Phone,
  phoneFieldProps,
  requireLocalPhones,
  toLocalPhoneDigits,
} from "../../lib/phone-field";

const PHONE_FIELDS = ["phone", "alternatePhone"] as const;

type RegisterFormValues = z.input<typeof UpdateStudentRequestSchema>;

interface RegisterStudentDialogProps {
  student: StudentDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after successful registration — chain the program-assignment step here. */
  onRegistered?: (student: StudentDetail) => void;
}

export function RegisterStudentDialog({
  student,
  open,
  onOpenChange,
  onRegistered,
}: RegisterStudentDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const updateStudent = useUpdateStudent();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(requireLocalPhones(UpdateStudentRequestSchema, PHONE_FIELDS)),
  });
  const { register, formState, watch, setValue, reset, handleSubmit } = form;
  const errors = formState.errors;

  React.useEffect(() => {
    if (open && student) {
      reset({
        name: student.name,
        // Stored E.164 → the 10 local digits the field is capped at.
        phone: toLocalPhoneDigits(student.phone) || undefined,
        alternatePhone: toLocalPhoneDigits(student.alternatePhone) || undefined,
        college: student.college ?? undefined,
        courseType: student.courseType,
        year: student.year ?? undefined,
        city: student.city ?? undefined,
        source: student.source ?? undefined,
      });
    }
  }, [open, student, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!student) return;
    try {
      // status:"active" is what "registration complete" means to the lifecycle
      // resolver: an active-status profile without an enrollment reads Registered.
      const body = UpdateStudentRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        alternatePhone: values.alternatePhone === null ? null : optionalE164Phone(values.alternatePhone),
        status: "active",
      });
      const updated = await updateStudent.mutateAsync({ id: student.id, body });
      toast({
        title: "Registration complete",
        description: `${updated.name} is now a registered student — assign a program next.`,
        variant: "success",
      });
      onOpenChange(false);
      onRegistered?.(updated);
    } catch (error) {
      surfaceError(toast, error, "Couldn't complete registration");
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        title="Register student"
        description={`Step 2 of 2 — full details for ${student?.name ?? "the student"}. Completing this marks them Registered.`}
        data-testid="register-student-drawer"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Full name" required placeholder="As it should appear on records" {...register("name")} error={errors.name?.message} data-testid="register-form-name" />
            <Input label="Email" value={student?.email ?? ""} disabled readOnly helperText="The contact's login identity — changing email is a separate verified flow." data-testid="register-form-email" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Phone" {...phoneFieldProps(register("phone", optionalText))} error={errors.phone?.message} data-testid="register-form-phone" />
              <Input
                label="Alternate phone"
                {...phoneFieldProps(register("alternatePhone", optionalText))}
                helperText="Guardian / secondary"
                error={errors.alternatePhone?.message}
                data-testid="register-form-alternate-phone"
              />
            </div>
            <Input label="College / University" placeholder="e.g. JNTU Hyderabad" {...register("college", optionalText)} error={errors.college?.message} data-testid="register-form-college" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Course type"
                required
                placeholder="Select course type"
                value={watch("courseType")}
                onValueChange={(value) => setValue("courseType", value as CourseType, { shouldValidate: true })}
                error={errors.courseType?.message}
                data-testid="register-form-course-type"
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
                {...register("year", optionalNumber)}
                error={errors.year?.message}
                data-testid="register-form-year"
              />
            </div>
            <Input label="City" placeholder="e.g. Bengaluru" {...register("city", optionalText)} error={errors.city?.message} data-testid="register-form-city" />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="register-form-later">
              Finish later
            </Button>
            <Button type="submit" loading={updateStudent.isPending} data-testid="register-form-submit">
              Complete registration
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
