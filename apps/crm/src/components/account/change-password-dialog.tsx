// Self-service "Change password" dialog — opened from the topbar account menu
// (components/layout/account-menu.tsx). Uses the SAME ChangePasswordRequestSchema
// pieces the server validates against (PasswordSchema from @repo/types, CLAUDE.md
// §3.2: "zod schemas reused FE+BE"), plus a client-only confirm field. Pure
// form/presentation — the mutation lives in hooks/use-change-password.ts.
//
// The endpoint revokes ALL of the caller's sessions on success (see
// packages/api-client/src/auth/auth.api.ts changePassword's doc), so we warn the
// user up front and the success toast confirms it; the account menu's mutation
// invalidates the cached `me` query, which routes the whole app back to sign-in.
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  PasswordInput,
  PasswordRequirements,
  useToast,
} from "@repo/ui";
import { PasswordSchema, checkPasswordRules } from "@repo/types";

import { useChangePassword } from "../../hooks/use-change-password";
import { errorCode, surfaceError } from "../../lib/surface-error";

// Client-only currentPassword + confirmPassword fields, plus the SAME PasswordSchema
// the server enforces for newPassword — never redeclare the policy here.
const ChangePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: PasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Choose a password different from your current one",
    path: ["newPassword"],
  });
type ChangePasswordFormValues = z.infer<typeof ChangePasswordFormSchema>;

const EMPTY_VALUES: ChangePasswordFormValues = { currentPassword: "", newPassword: "", confirmPassword: "" };

export interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const changePassword = useChangePassword();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(ChangePasswordFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Live requirement checklist — watch() so it re-evaluates per keystroke.
  const newPasswordRules = checkPasswordRules(watch("newPassword") ?? "");

  // Blank the form every time the dialog opens (and after it closes) rather than
  // leaving a half-typed password sitting in memory/DOM between openings.
  React.useEffect(() => {
    if (!open) reset(EMPTY_VALUES);
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast({
        title: "Password changed",
        description: "For your security you've been signed out everywhere — sign in again with your new password.",
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      // Pin field-specific business errors to the field they belong to (mirrors
      // student-form-drawer's email_in_use pattern) instead of a toast that
      // disappears before the user can act on it.
      const code = errorCode(error);
      if (code === "auth.current_password_invalid") {
        setError("currentPassword", { type: "server", message: "Current password is incorrect" }, { shouldFocus: true });
        return;
      }
      if (code === "auth.password_unchanged") {
        setError(
          "newPassword",
          { type: "server", message: "Your new password must be different from your current password" },
          { shouldFocus: true },
        );
        return;
      }
      surfaceError(toast, error, "Couldn't change your password");
    }
  });

  const busy = changePassword.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        position="center"
        size="sm"
        title="Change password"
        description="Setting a new password signs you out of every session, including this one."
        data-testid="change-password-dialog"
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col overflow-hidden">
          <DrawerBody className="flex flex-col gap-4">
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              autoFocus
              required
              {...register("currentPassword")}
              error={errors.currentPassword?.message}
              data-testid="change-password-current"
              toggleTestId="change-password-current-toggle"
            />
            {/* Explicit id so BOTH the error text (Input derives `${id}-error`) and the
                requirement list can be referenced — Input spreads caller props after its
                own computed aria-describedby, so passing one here replaces rather than
                merges, and the error association has to be preserved by hand. */}
            <div className="flex flex-col gap-1.5">
              <PasswordInput
                id="change-password-new"
                label="New password"
                autoComplete="new-password"
                required
                {...register("newPassword")}
                error={errors.newPassword?.message}
                aria-describedby={
                  errors.newPassword
                    ? "change-password-new-error change-password-new-reqs"
                    : "change-password-new-reqs"
                }
                data-testid="change-password-new"
                toggleTestId="change-password-new-toggle"
              />
              <PasswordRequirements
                id="change-password-new-reqs"
                rules={newPasswordRules}
                data-testid="change-password-requirements"
              />
            </div>
            <PasswordInput
              label="Confirm new password"
              autoComplete="new-password"
              required
              {...register("confirmPassword")}
              error={errors.confirmPassword?.message}
              data-testid="change-password-confirm"
              toggleTestId="change-password-confirm-toggle"
            />
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              data-testid="change-password-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy} data-testid="change-password-submit">
              Change password
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
