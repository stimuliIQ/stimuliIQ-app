// Revoke certificate dialog — destructive action, must confirm with reason.
// Uses Drawer (not AlertDialog) because the form needs a required reason field.
// Permission: certificates.revoke (scope: all).
// Revocation is instant — public verify reflects it immediately (AC-G1/AC-G2).
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  Input,
  useToast,
} from "@repo/ui";
import { RevokeCertificateRequestSchema, type RevokeCertificateRequest } from "@repo/types";

import { useRevokeCertificate } from "../../hooks/use-certificates";

interface RevokeCertificateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certificateId: string | null;
  studentName?: string;
  certUid?: string | null;
}

export function RevokeCertificateDialog({
  open,
  onOpenChange,
  certificateId,
  studentName,
  certUid: _certUid,
}: RevokeCertificateDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const revokeCertificate = useRevokeCertificate();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RevokeCertificateRequest>({
    resolver: zodResolver(RevokeCertificateRequestSchema),
    defaultValues: { reason: "" },
  });

  React.useEffect(() => {
    if (!open) reset({ reason: "" });
  }, [open, reset]);

  const isPending = revokeCertificate.isPending;

  const onSubmit = handleSubmit(async (values) => {
    if (!certificateId) return;
    try {
      await revokeCertificate.mutateAsync({ id: certificateId, body: values });
      toast({
        title: "Certificate revoked",
        description: "The verification link now shows 'revoked' immediately.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't revoke certificate", description, variant: "destructive" });
    }
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Revoke certificate?"
        description={
          studentName
            ? `You are about to revoke the certificate for ${studentName}.`
            : "You are about to revoke this certificate."
        }
        size="sm"
        data-testid="revoke-certificate-dialog"
      >
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <Alert tone="danger" icon={<AlertTriangle />}>
              This is <strong>instant and irreversible</strong> — the public verify link will
              show "revoked" immediately. You can reissue a new certificate separately.
            </Alert>

            <Input
              label="Reason for revocation"
              required
              placeholder="e.g. Issued in error — student did not complete the program"
              {...register("reason")}
              error={errors.reason?.message}
              helperText="This is for internal audit. Not shown publicly."
              data-testid="revoke-reason-input"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              data-testid="revoke-cert-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              loading={isPending}
              data-testid="revoke-cert-confirm"
            >
              Revoke certificate
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
