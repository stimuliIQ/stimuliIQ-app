// Reset-password page (/reset-password?token=...) — the exact landing page
// PasswordResetService.request() builds into the emailed link
// (`${LMS_APP_URL}/reset-password?token=...`, apps/api/src/modules/auth/
// password-reset.service.ts). QA defect #5: this page did not exist, so the
// link 404'd. Suspense-wraps the `useSearchParams()` read (App Router
// requirement for a statically-rendered page), matching ../login/page.tsx's
// Suspense idiom.
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { PasswordSchema } from "@repo/types";

import { AuthSplitLayout } from "../../components/auth/auth-split-layout";
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

export default function ResetPasswordPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}

function ResetPasswordFallback(): React.JSX.Element {
  return (
    <AuthSplitLayout busy title="Set a new password" description="Loading…">
      {null}
    </AuthSplitLayout>
  );
}

function ResetPasswordForm(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
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
    confirmReset.mutate(
      { token, newPassword: values.newPassword },
      {
        onSuccess: () => {
          router.replace("/login?reset=success");
        },
      },
    );
  });

  // Missing token entirely -> the link itself is malformed; never call the
  // API at all, just point the student at requesting a fresh one.
  if (!token) {
    return (
      <AuthSplitLayout
        data-testid="reset-password-missing-token"
        title="Reset link is invalid"
        description="This link is missing its reset token. Request a new password reset link."
      >
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthSplitLayout>
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
    <AuthSplitLayout
      data-testid="reset-password-card"
      title="Set a new password"
      description="Choose a new password for your stimuliiq account."
      footer={
        <p className="text-center text-sm text-fg-muted">
          <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
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
                <Link href="/forgot-password" className="underline underline-offset-4">
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
    </AuthSplitLayout>
  );
}
