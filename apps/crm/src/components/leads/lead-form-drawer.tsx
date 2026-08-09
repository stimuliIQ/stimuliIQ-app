// Create-lead drawer — RHF + zod resolver against CreateLeadRequestSchema
// (@repo/types), same pattern as coupon-form-drawer.tsx/batch-form-drawer.tsx.
// Leads are not edited via this drawer once created beyond what
// UpdateLeadRequest covers (stage/owner have their own dedicated endpoints —
// see lead-detail-drawer.tsx's stage-move + reassign-owner controls).
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
import { CreateLeadRequestSchema, type CreateLeadRequest } from "@repo/types";

import { useCreateLead } from "../../hooks/use-leads";
import { useProgramsList } from "../../hooks/use-courses";
import { useAllBranches } from "../../hooks/use-branches";
import { surfaceError } from "../../lib/surface-error";
import { phoneFieldProps, isCompleteLocalPhone, toE164Phone } from "../../lib/phone-field";
import { PHONE_LENGTH_MESSAGE } from "@repo/ui";
import { OwnerSelect } from "./owner-select";

interface LeadFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// RHF state — flattens utm fields for simpler inputs; reassembled into the
// nested `utm` object shape at submit time.
interface LeadFormValues {
  name: string;
  phone: string;
  email?: string;
  programInterestId?: string;
  source: string;
  branchId?: string;
  ownerId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export function LeadFormDrawer({ open, onOpenChange }: LeadFormDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const createLead = useCreateLead();
  const { data: programsData } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const { data: branchesData } = useAllBranches();

  const { register, handleSubmit, reset, watch, setValue, setError, formState } = useForm<LeadFormValues>();
  const errors = formState.errors;

  React.useEffect(() => {
    if (open) reset({});
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    // This form has no zod resolver, so the 10-digit rule is checked here.
    if (!isCompleteLocalPhone(values.phone)) {
      setError("phone", { type: "manual", message: PHONE_LENGTH_MESSAGE }, { shouldFocus: true });
      return;
    }
    try {
      const hasUtm = Boolean(values.utmSource || values.utmMedium || values.utmCampaign);
      const body: CreateLeadRequest = CreateLeadRequestSchema.parse({
        name: values.name,
        phone: toE164Phone(values.phone),
        email: values.email || undefined,
        programInterestId: values.programInterestId || undefined,
        source: values.source,
        branchId: values.branchId || undefined,
        ownerId: values.ownerId || undefined,
        utm: hasUtm
          ? {
              source: values.utmSource || undefined,
              medium: values.utmMedium || undefined,
              campaign: values.utmCampaign || undefined,
            }
          : undefined,
      });
      await createLead.mutateAsync(body);
      toast({ title: "Lead created", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't create lead");
    }
  });

  const programs = programsData?.items ?? [];
  const branches = branchesData?.items ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="center"
        title="Add lead"
        description="Add a new lead to the pipeline. Stage starts at New."
        data-testid="lead-create-drawer"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Input
              label="Name"
              placeholder="e.g. Priya Sharma"
              required
              {...register("name")}
              error={errors.name?.message}
              data-testid="lead-form-name"
            />
            <Input
              label="Phone"
              required
              {...phoneFieldProps(register("phone"))}
              error={errors.phone?.message}
              data-testid="lead-form-phone"
            />
            <Input
              label="Email"
              type="email"
              placeholder="name@example.com"
              {...register("email")}
              error={errors.email?.message}
              data-testid="lead-form-email"
            />
            <Select
              label="Program interest"
              placeholder="Not specified"
              value={watch("programInterestId")}
              onValueChange={(value) => setValue("programInterestId", value === "__none__" ? undefined : value)}
              data-testid="lead-form-program"
            >
              <SelectItem value="__none__">Not specified</SelectItem>
              {programs.map((program) => (
                <SelectItem key={program.id} value={program.id}>
                  {program.title}
                </SelectItem>
              ))}
            </Select>
            <Input
              label="Source"
              required
              placeholder="website, referral, facebook…"
              helperText="Lead source label for attribution."
              {...register("source")}
              error={errors.source?.message}
              data-testid="lead-form-source"
            />
            <Select
              label="Branch"
              placeholder="Not specified"
              value={watch("branchId")}
              onValueChange={(value) => setValue("branchId", value === "__none__" ? undefined : value)}
              data-testid="lead-form-branch"
            >
              <SelectItem value="__none__">Not specified</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name} ({branch.city})
                </SelectItem>
              ))}
            </Select>
            {/* Leaving this on "Unassigned" is the normal path, not a gap: the backend
                round-robins to whoever has the fewest open leads, which balances the
                team better than a human picking a familiar name. Choose explicitly only
                when this lead should go to a specific person. */}
            <OwnerSelect
              label="Owner"
              value={watch("ownerId") ?? null}
              onChange={(value) => setValue("ownerId", value ?? undefined)}
              data-testid="lead-form-owner"
            />
            <p className="-mt-2 text-xs text-fg-muted">
              Leave as Unassigned to auto-assign to whoever currently has the fewest open leads. Whoever it lands on is
              notified in the CRM.
            </p>
            <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium text-fg">UTM (optional)</legend>
              <Input
                label="utm_source"
                placeholder="e.g. google"
                {...register("utmSource")}
                data-testid="lead-form-utm-source"
              />
              <Input
                label="utm_medium"
                placeholder="e.g. cpc"
                {...register("utmMedium")}
                data-testid="lead-form-utm-medium"
              />
              <Input
                label="utm_campaign"
                placeholder="e.g. october-leads"
                {...register("utmCampaign")}
                data-testid="lead-form-utm-campaign"
              />
            </fieldset>
          </DrawerBody>
          <DrawerFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} data-testid="lead-form-cancel">
              Cancel
            </Button>
            <Button type="submit" loading={createLead.isPending} data-testid="lead-form-submit">
              Create lead
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
