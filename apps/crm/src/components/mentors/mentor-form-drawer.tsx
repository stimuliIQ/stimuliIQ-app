// Create/Edit mentor drawer — RHF + zod resolver against
// CreateMentorRequestSchema/UpdateMentorRequestSchema (@repo/types), same
// pattern as faculty-form-drawer.tsx. `expertise` is a comma-separated text
// field (no tag-input primitive in @repo/ui yet, mirrors faculty). `notes`
// uses a single-line Input for the same reason (no Textarea primitive yet).
//
// AC-3 (docs/specs/phase-8-mentor.md): engagementStatus='active' requires
// joinedAt — this is a service-layer 422 JOINED_DATE_REQUIRED, not a zod
// shape check (see @repo/types' file header), so the server is the real
// gate; the client-side guard below just saves a round trip and gives an
// inline field error instead of a toast.
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
import { CreateMentorRequestSchema, UpdateMentorRequestSchema, type MentorDetail, type MentorEngagementStatus } from "@repo/types";

import { useCreateMentor, useUpdateMentor } from "../../hooks/use-mentors";
import { surfaceError } from "../../lib/surface-error";
import { MentorProfileFields, normalizeProfileValues } from "./mentor-profile-fields";
import {
  optionalE164Phone,
  phoneFieldProps,
  requireLocalPhones,
  toLocalPhoneDigits,
} from "../../lib/phone-field";

const PHONE_FIELDS = ["phone"] as const;

// Use the schema's *input* type (pre-`.default()`) for the RHF generic —
// CreateMentorRequest is the inferred *output* type, which makes
// `expertise`/`engagementStatus` required and breaks the zodResolver's
// input/output contract (mirrors faculty-form-drawer.tsx).
type CreateMentorFormValues = z.input<typeof CreateMentorRequestSchema>;
type UpdateMentorFormValues = z.input<typeof UpdateMentorRequestSchema>;

const ENGAGEMENT_STATUSES: { value: MentorEngagementStatus; label: string }[] = [
  { value: "prospective", label: "Prospective" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface MentorFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentor?: MentorDetail;
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

export function MentorFormDrawer({ open, onOpenChange, mentor }: MentorFormDrawerProps): React.JSX.Element {
  const isEdit = Boolean(mentor);
  const { toast } = useToast();
  const createMentor = useCreateMentor();
  const updateMentor = useUpdateMentor();

  const createForm = useForm<CreateMentorFormValues>({
    resolver: zodResolver(requireLocalPhones(CreateMentorRequestSchema, PHONE_FIELDS)),
    defaultValues: { expertise: [], engagementStatus: "prospective" },
  });
  const updateForm = useForm<UpdateMentorFormValues>({
    resolver: zodResolver(requireLocalPhones(UpdateMentorRequestSchema, PHONE_FIELDS)),
  });

  const [expertiseText, setExpertiseText] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && mentor) {
      updateForm.reset({
        fullName: mentor.fullName,
        email: mentor.email,
        phone: toLocalPhoneDigits(mentor.phone) || undefined,
        externalInstitute: mentor.externalInstitute,
        expertise: mentor.expertise,
        engagementStatus: mentor.engagementStatus,
        joinedAt: mentor.joinedAt ?? undefined,
        notes: mentor.notes ?? undefined,
        title: mentor.title ?? undefined,
        bio: mentor.bio ?? undefined,
        yearsExperience: mentor.yearsExperience ?? undefined,
        socialLinks: mentor.socialLinks ?? undefined,
        // photoKey is intentionally NOT reset — MentorDetail exposes photoUrl (for the
        // preview) but never the raw key; leaving photoKey undefined means "unchanged"
        // unless the user uploads a new photo or clears it.
      });
      setExpertiseText(expertiseToText(mentor.expertise));
    } else {
      createForm.reset({ expertise: [], engagementStatus: "prospective" });
      setExpertiseText("");
    }
    // Intentionally reset only on open/identity change, not on every render.
  }, [open, isEdit, mentor]);

  const isPending = createMentor.isPending || updateMentor.isPending;

  const onSubmitCreate = createForm.handleSubmit(async (values) => {
    if (values.engagementStatus === "active" && !values.joinedAt) {
      createForm.setError("joinedAt", { message: "Required while status is Active" });
      return;
    }
    try {
      const body = CreateMentorRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        expertise: textToExpertise(expertiseText),
        ...normalizeProfileValues(values),
        // "Remove photo" sets photoKey null (the edit-mode "clear" semantic);
        // the create schema is optional-not-nullable, so null → undefined here.
        photoKey: values.photoKey ?? undefined,
      });
      await createMentor.mutateAsync(body);
      toast({ title: "Mentor created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create mentor");
    }
  });

  const onSubmitUpdate = updateForm.handleSubmit(async (values) => {
    if (!mentor) return;
    if (values.engagementStatus === "active" && !values.joinedAt) {
      updateForm.setError("joinedAt", { message: "Required while status is Active" });
      return;
    }
    try {
      const body = UpdateMentorRequestSchema.parse({
        ...values,
        phone: optionalE164Phone(values.phone),
        expertise: textToExpertise(expertiseText),
        ...normalizeProfileValues(values),
      });
      await updateMentor.mutateAsync({ id: mentor.id, body });
      toast({ title: "Mentor updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update mentor");
    }
  });

  if (isEdit) {
    const { register, watch, setValue, formState } = updateForm;
    const errors = formState.errors;
    const status = watch("engagementStatus");
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent position="center" title="Edit mentor" description={mentor?.email} data-testid="mentor-edit-drawer">
          <form onSubmit={onSubmitUpdate} className="flex flex-1 flex-col overflow-hidden">
            <DrawerBody className="flex flex-col gap-4">
              <Input
                label="Full name"
                required
                placeholder="e.g. Priya Sharma"
                {...register("fullName")}
                error={errors.fullName?.message}
                data-testid="mentor-form-fullname"
              />
              <Input
                label="Email"
                type="email"
                required
                placeholder="name@example.com"
                {...register("email")}
                error={errors.email?.message}
                data-testid="mentor-form-email"
              />
              <Input label="Phone" {...phoneFieldProps(register("phone"))} error={errors.phone?.message} data-testid="mentor-form-phone" />
              <Input
                label="External institute"
                required
                placeholder="e.g. Infosys"
                {...register("externalInstitute")}
                error={errors.externalInstitute?.message}
                data-testid="mentor-form-institute"
              />
              <Input
                label="Expertise"
                helperText="Comma-separated, e.g. React, Node.js, Data Structures"
                placeholder="e.g. React, Node.js, System Design"
                value={expertiseText}
                onChange={(event) => setExpertiseText(event.target.value)}
                data-testid="mentor-form-expertise"
              />
              <Select
                label="Engagement status"
                required
                placeholder="Select engagement status"
                value={status}
                onValueChange={(value) => setValue("engagementStatus", value as MentorEngagementStatus)}
                error={errors.engagementStatus?.message}
                data-testid="mentor-form-status"
              >
                {ENGAGEMENT_STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>
              <Input
                label="Joined date"
                type="date"
                required={status === "active"}
                helperText={
                  status === "active" ? "Required while status is Active." : "Only required once status is Active."
                }
                {...register("joinedAt")}
                error={errors.joinedAt?.message}
                data-testid="mentor-form-joined-at"
              />
              <Input label="Notes" placeholder="Any internal notes about this mentor" {...register("notes")} error={errors.notes?.message} data-testid="mentor-form-notes" />
              <MentorProfileFields
                register={register}
                setValue={setValue}
                watch={watch}
                initialPhotoUrl={mentor?.photoUrl ?? null}
              />
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="mentor-form-cancel">
                Cancel
              </Button>
              <Button type="submit" loading={isPending} data-testid="mentor-form-submit">
                Save changes
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    );
  }

  const { register, watch, setValue, formState } = createForm;
  const errors = formState.errors;
  const status = watch("engagementStatus");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Add mentor"
        description="Record a new mentor hiring candidate. Doesn't grant a dashboard login by itself."
        data-testid="mentor-create-drawer"
      >
        <form onSubmit={onSubmitCreate} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Full name"
              required
              placeholder="e.g. Priya Sharma"
              {...register("fullName")}
              error={errors.fullName?.message}
              data-testid="mentor-form-fullname"
            />
            <Input
              label="Email"
              type="email"
              required
              placeholder="name@example.com"
              {...register("email")}
              error={errors.email?.message}
              data-testid="mentor-form-email"
            />
            <Input label="Phone" {...phoneFieldProps(register("phone"))} error={errors.phone?.message} data-testid="mentor-form-phone" />
            <Input
              label="External institute"
              required
              placeholder="e.g. Infosys"
              {...register("externalInstitute")}
              error={errors.externalInstitute?.message}
              data-testid="mentor-form-institute"
            />
            <Input
              label="Expertise"
              helperText="Comma-separated, e.g. React, Node.js, Data Structures"
              placeholder="e.g. React, Node.js, System Design"
              value={expertiseText}
              onChange={(event) => setExpertiseText(event.target.value)}
              data-testid="mentor-form-expertise"
            />
            <Select
              label="Engagement status"
              required
              placeholder="Select engagement status"
              value={status}
              onValueChange={(value) => setValue("engagementStatus", value as MentorEngagementStatus)}
              error={errors.engagementStatus?.message}
              data-testid="mentor-form-status"
            >
              {ENGAGEMENT_STATUSES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
            <Input
              label="Joined date"
              type="date"
              required={status === "active"}
              helperText={
                status === "active" ? "Required while status is Active." : "Only required once status is Active."
              }
              {...register("joinedAt")}
              error={errors.joinedAt?.message}
              data-testid="mentor-form-joined-at"
            />
            <Input label="Notes" placeholder="Any internal notes about this mentor" {...register("notes")} error={errors.notes?.message} data-testid="mentor-form-notes" />
            <MentorProfileFields register={register} setValue={setValue} watch={watch} />
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="mentor-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="mentor-form-submit">
              Create mentor
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
