// Reset-password form (`/reset-password?token=...`) — the CRM counterpart of
// the LMS's ../../../lms/src/app/reset-password/page.tsx. `token` is read
// from the TanStack Router search params by the route
// (../../routes/reset-password-route.tsx) and passed in as a prop so this
// component stays a pure presentation + form-state layer (CLAUDE.md §3: "no
// business logic in components").
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { PasswordSchema } from "@repo/types";

import { useConfirmPasswordReset } from "../../hooks/use-confirm-password-reset";

// ConfirmPasswordResetRequestSchema (@repo/types) is `.strict()` and has no
// `confirmPassword` field (the token comes from the URL, not the form; the
// match check is purely client-side UX). We build the form's local schema
// from the SAME `PasswordSchema` the API-facing schema uses, so the strength
// rule enforced here is identical to the server's — only the extra
// client-only `confirmPassword` field + its match-refinement are additive.
const ResetPasswordFormSchema = z
  .object({
    newPassword: PasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ResetPasswordFormValues = z.infer<typeof ResetPasswordFormSchema>;

export interface ResetPasswordFormProps {
  token: string | undefined;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps): React.JSX.Element {
  const confirmReset = useConfirmPasswordReset();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(ResetPasswordFormSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit((values) => {
    if (!token) return;
    confirmReset.mutate({ token, newPassword: values.newPassword });
  });

  // Success -> no navigation (the dashboard route's search params aren't
  // typed for a "?reset=success" banner, and AppShell already gates every
  // path on `me` when signed out — the sign-in link below lands on the same
  // LoginForm regardless). Show the confirmation inline instead, matching
  // ForgotPasswordForm's settled-state idiom.
  if (confirmReset.isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-4" data-density="compact">
        <Card className="w-full max-w-sm" data-testid="reset-password-success">
          <CardHeader>
            <CardTitle>Password reset</CardTitle>
            <CardDescription>Your password has been reset. Sign in with your new password.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Missing token entirely -> the link itself is malformed; never call the
  // API at all, just point the staff member at requesting a fresh one.
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-4" data-density="compact">
        <Card className="w-full max-w-sm" data-testid="reset-password-missing-token">
          <CardHeader>
            <CardTitle>Reset link is invalid</CardTitle>
            <CardDescription>
              This link is missing its reset token. Request a new password reset link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Optional chaining throughout: a raw network failure (offline, DNS, etc.)
  // throws something that is NOT an ApiError, so `.problem` would not exist —
  // never let that throw while rendering the error string.
  const submitError =
    confirmReset.error instanceof ApiError
      ? (confirmReset.error.problem?.detail ?? confirmReset.error.problem?.title ?? "This reset link is invalid or has expired.")
      : confirmReset.error
        ? "Something went wrong. Please try again."
        : null;

  const busy = isSubmitting || confirmReset.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4" data-density="compact">
      <Card className="w-full max-w-sm" data-testid="reset-password-card">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Choose a new password for your stimuliiq admin account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password-new">New password</Label>
              <PasswordInput
                id="reset-password-new"
                placeholder="At least 10 characters"
                autoComplete="new-password"
                autoFocus
                toggleTestId="reset-password-new-toggle"
                aria-invalid={errors.newPassword ? true : undefined}
                aria-describedby={errors.newPassword ? "reset-password-new-error" : undefined}
                {...register("newPassword")}
              />
              {errors.newPassword ? (
                <p id="reset-password-new-error" role="alert" className="text-sm text-danger">
                  {errors.newPassword.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reset-password-confirm">Confirm new password</Label>
              <PasswordInput
                id="reset-password-confirm"
                placeholder="Re-enter new password"
                autoComplete="new-password"
                toggleTestId="reset-password-confirm-toggle"
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={errors.confirmPassword ? "reset-password-confirm-error" : undefined}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword ? (
                <p id="reset-password-confirm-error" role="alert" className="text-sm text-danger">
                  {errors.confirmPassword.message}
                </p>
              ) : null}
            </div>

            {submitError ? (
              <p role="alert" data-testid="reset-password-error" className="text-sm text-danger">
                {submitError}
                {confirmReset.error instanceof ApiError && confirmReset.error.status === 422 ? (
                  <>
                    {" "}
                    <Link to="/forgot-password" className="underline underline-offset-4">
                      Request a new link
                    </Link>
                    .
                  </>
                ) : null}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy} aria-busy={busy} data-testid="reset-password-submit">
              {busy ? "Resetting…" : "Reset password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
