// Issue certificate dialog — ops issues a cert for an eligible enrollment.
// Server runs eligibility engine first (422 NOT_ELIGIBLE with reasons on fail).
// Permission: certificates.issue (scope: all | branch).
// Uses Drawer (not AlertDialog) because the form needs a template selector field.
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Select,
  SelectItem,
  useToast,
} from "@repo/ui";
import { IssueCertificateRequestSchema, type IssueCertificateRequest } from "@repo/types";
import type { z } from "zod";

import { useIssueCertificate, useCertificateTemplates } from "../../hooks/use-certificates";
import { queryErrorMessage } from "../../lib/surface-error";

interface IssueCertificateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollmentId: string | null;
  studentName?: string;
}

// Use the zod input type so zodResolver doesn't cause a resolver mismatch.
// overrideEligibility has .default(false) which makes it optional in the input shape.
type IssueCertificateFormValues = z.input<typeof IssueCertificateRequestSchema>;

export function IssueCertificateDialog({
  open,
  onOpenChange,
  enrollmentId,
  studentName,
}: IssueCertificateDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const issueCertificate = useIssueCertificate();
  const { data: templatesData } = useCertificateTemplates();

  const templates = templatesData?.items ?? [];

  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<IssueCertificateFormValues>({
    resolver: zodResolver(IssueCertificateRequestSchema),
    defaultValues: {
      enrollmentId: enrollmentId ?? "",
      overrideEligibility: false,
    },
  });

  React.useEffect(() => {
    if (!open) return;
    reset({
      enrollmentId: enrollmentId ?? "",
      overrideEligibility: false,
    });
  }, [open, enrollmentId, reset]);

  const isPending = issueCertificate.isPending;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await issueCertificate.mutateAsync(values as unknown as IssueCertificateRequest);
      toast({ title: "Certificate issued", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      const description = queryErrorMessage(error);
      toast({ title: "Couldn't issue certificate", description, variant: "destructive" });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Issue certificate"
        description={
          studentName
            ? `Issue a certificate to ${studentName}. The eligibility engine verifies all gates before issuing.`
            : "The eligibility engine will verify all gates before issuing."
        }
        size="sm"
        data-testid="issue-certificate-dialog"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Controller
              control={control}
              name="templateId"
              render={({ field }) => (
                <Select
                  label="Certificate template"
                  required
                  placeholder="Select a template"
                  value={field.value}
                  onValueChange={field.onChange}
                  error={errors.templateId?.message}
                  data-testid="issue-cert-template-select"
                >
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </Select>
              )}
            />
            <p className="text-xs text-fg-muted">
              The server will re-verify eligibility before issuing. If the student is not eligible,
              the request will return 422 with the reason breakdown.
            </p>
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              data-testid="issue-cert-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" loading={isPending} data-testid="issue-cert-confirm">
              Issue certificate
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
