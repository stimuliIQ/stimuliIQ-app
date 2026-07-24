// Change-password page (/change-password) — the forced first-login gate landing
// (lifecycle-redesign P3). A student whose LMS account was auto-provisioned with a
// temporary password (must_change_password = true) is redirected here by
// FirstLoginGate and cannot reach any learning content until they set a new password.
//
// Standalone (NOT wrapped in LmsShell) so the gate never fires on this page itself.
// On success the server has revoked all sessions + cleared cookies, so we route to
// /login for a fresh sign-in with the new password.
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { PasswordSchema } from "@repo/types";

import { AuthSplitLayout } from "../../components/auth/auth-split-layout";
import { useChangePassword } from "../../hooks/use-change-password";

// Built from the SAME PasswordSchema the server enforces, plus client-only
// currentPassword + confirmPassword fields and a match refinement.
const ChangePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your temporary password"),
    newPassword: PasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Choose a password different from your temporary one",
    path: ["newPassword"],
  });
type ChangePasswordFormValues = z.infer<typeof ChangePasswordFormSchema>;

export default function ChangePasswordPage(): React.JSX.Element {
  const router = useRouter();
  const changePassword = useChangePassword();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(ChangePasswordFormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit((values) => {
    changePassword.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          // All sessions were revoked server-side — sign in again with the new password.
          router.replace("/login?passwordChanged=1");
        },
      },
    );
  });

  const submitError =
    changePassword.error instanceof ApiError
      ? (changePassword.error.problem?.detail ??
        changePassword.error.problem?.title ??
        "Couldn't change your password. Please try again.")
      : changePassword.error
        ? "Something went wrong. Please try again."
        : null;

  const busy = isSubmitting || changePassword.isPending;

  return (
    <AuthSplitLayout
      data-testid="change-password-card"
      title="Set your password"
      description="Welcome! For your security, please replace the temporary password from your welcome email with one of your own before continuing."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="change-password-current">Temporary password</Label>
          <PasswordInput
            id="change-password-current"
            placeholder="From your welcome email"
            autoComplete="current-password"
            autoFocus
            toggleTestId="change-password-current-toggle"
            aria-invalid={errors.currentPassword ? true : undefined}
            aria-describedby={errors.currentPassword ? "change-password-current-error" : undefined}
            {...register("currentPassword")}
          />
          {errors.currentPassword ? (
            <p id="change-password-current-error" role="alert" className="text-sm text-danger">
              {errors.currentPassword.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="change-password-new">New password</Label>
          <PasswordInput
            id="change-password-new"
            placeholder="At least 10 characters"
            autoComplete="new-password"
            toggleTestId="change-password-new-toggle"
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={errors.newPassword ? "change-password-new-error" : undefined}
            {...register("newPassword")}
          />
          {errors.newPassword ? (
            <p id="change-password-new-error" role="alert" className="text-sm text-danger">
              {errors.newPassword.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="change-password-confirm">Confirm new password</Label>
          <PasswordInput
            id="change-password-confirm"
            placeholder="Re-enter new password"
            autoComplete="new-password"
            toggleTestId="change-password-confirm-toggle"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? "change-password-confirm-error" : undefined}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p id="change-password-confirm-error" role="alert" className="text-sm text-danger">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <p role="alert" data-testid="change-password-error" className="text-sm text-danger">
            {submitError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : "Set password & continue"}
        </Button>
      </form>
    </AuthSplitLayout>
  );
}
