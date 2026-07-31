// Create/Edit faculty drawer — RHF + zod resolver against
// CreateFacultyRequestSchema/UpdateFacultyRequestSchema (@repo/types), same
// pattern as student-form-drawer.tsx. `expertise` is a string[] entered as a
// comma-separated field for simplicity (no tag-input primitive in @repo/ui yet).
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Input, useToast } from "@repo/ui";
import {
  CreateFacultyRequestSchema,
  UpdateFacultyRequestSchema,
  type FacultyDetail,
} from "@repo/types";

// Use the schema's *input* type (pre-`.default()`) for the RHF generic —
// CreateFacultyRequest is the inferred *output* type, which makes
// `expertise` required and breaks the zodResolver's input/output contract.
type CreateFacultyFormValues = z.input<typeof CreateFacultyRequestSchema>;
type UpdateFacultyFormValues = z.input<typeof UpdateFacultyRequestSchema>;

import { useCreateFaculty, useUpdateFaculty } from "../../hooks/use-faculty";
import {
  optionalE164Phone,
  phoneFieldProps,
  requireLocalPhones,
  toLocalPhoneDigits,
} from "../../lib/phone-field";

const PHONE_FIELDS = ["phone"] as const;

interface FacultyFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  faculty?: FacultyDetail;
}

function expertiseToText(expertise: string[]): string {
  return expertise.join(", ");
}

function textToExpertise(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function FacultyFormDrawer({ open, onOpenChange, faculty }: FacultyFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(faculty);
  const { toast } = useToast();
  const createFaculty = useCreateFaculty();
  const updateFaculty = useUpdateFaculty();

  const createForm = useForm<CreateFacultyFormValues>({
    resolver: zodResolver(requireLocalPhones(CreateFacultyRequestSchema, PHONE_FIELDS)),
    defaultValues: { expertise: [] },
  });
  const updateForm = useForm<UpdateFacultyFormValues>({
    resolver: zodResolver(requireLocalPhones(UpdateFacultyRequestSchema, PHONE_FIELDS)),
  });

  const [expertiseText, setExpertiseText] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && faculty) {
      updateForm.reset({
        name: faculty.name,
        phone: toLocalPhoneDigits(faculty.phone) || undefined,
        expertise: faculty.expertise,
        bio: faculty.bio ?? undefined,
        branchId: faculty.branchId,
      });
      setExpertiseText(expertiseToText(faculty.expertise));
    } else {
      createForm.reset({ expertise: [] });
      setExpertiseText("");
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, faculty]);

  const isPending = createFaculty.isPending || updateFaculty.isPending;

  const onSubmitCreate = createForm.handleSubmit(async (values) => {
    try {
      const body = CreateFacultyRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        expertise: textToExpertise(expertiseText),
      });
      await createFaculty.mutateAsync(body);
      toast({ title: "Faculty member created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't create faculty member",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  });

  const onSubmitUpdate = updateForm.handleSubmit(async (values) => {
    if (!faculty) return;
    try {
      const body = UpdateFacultyRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        expertise: textToExpertise(expertiseText),
      });
      await updateFaculty.mutateAsync({ id: faculty.id, body });
      toast({ title: "Faculty member updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't update faculty member",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  });

  if (isEdit) {
    const { register, formState } = updateForm;
    const errors = formState.errors;
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent position="center" title="Edit faculty" description={faculty?.email} data-testid="faculty-edit-drawer">
          <form onSubmit={onSubmitUpdate} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input label="Full name" required placeholder="e.g. Priya Sharma" {...register("name")} error={errors.name?.message} data-testid="faculty-form-name" />
              <Input label="Phone" {...phoneFieldProps(register("phone"))} error={errors.phone?.message} data-testid="faculty-form-phone" />
              <Input
                label="Expertise"
                helperText="Comma-separated, e.g. React, Node.js, Data Structures"
                placeholder="e.g. React, Node.js, System Design"
                value={expertiseText}
                onChange={(event) => setExpertiseText(event.target.value)}
                data-testid="faculty-form-expertise"
              />
              <Input label="Bio" placeholder="A short professional bio…" {...register("bio")} error={errors.bio?.message} data-testid="faculty-form-bio" />
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="faculty-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="faculty-form-submit">
                Save changes
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    );
  }

  const { register, formState } = createForm;
  const errors = formState.errors;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center" title="Add faculty" description="Creates a staff record and an invited account." data-testid="faculty-create-drawer">
        <form onSubmit={onSubmitCreate} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input label="Full name" required placeholder="e.g. Priya Sharma" {...register("name")} error={errors.name?.message} data-testid="faculty-form-name" />
            <Input label="Email" type="email" required placeholder="name@example.com" {...register("email")} error={errors.email?.message} data-testid="faculty-form-email" />
            <Input label="Phone" {...phoneFieldProps(register("phone"))} error={errors.phone?.message} data-testid="faculty-form-phone" />
            <Input
              label="Expertise"
              helperText="Comma-separated, e.g. React, Node.js, Data Structures"
              placeholder="e.g. React, Node.js, System Design"
              value={expertiseText}
              onChange={(event) => setExpertiseText(event.target.value)}
              data-testid="faculty-form-expertise"
            />
            <Input label="Bio" placeholder="A short professional bio…" {...register("bio")} error={errors.bio?.message} data-testid="faculty-form-bio" />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="faculty-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="faculty-form-submit">
              Create faculty
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
