// Forgot-password page (/forgot-password) — QA defect #5 fix: the login page
// had no path into the password-reset flow. RHF + zodResolver against
// RequestPasswordResetRequestSchema (@repo/types), the same schema the API
// validates against — matches the LoginForm idiom in ../login/page.tsx.
//
// ENUMERATION RESISTANCE: POST /auth/password-reset/request ALWAYS returns 200
// with an identical generic message whether or not the email exists (see
// apps/api/src/modules/auth/password-reset.service.ts). We deliberately show
// the SAME neutral confirmation on success *and* on failure (network/5xx) —
// a distinguishable error state here would itself become a timing/behavior
// oracle for account enumeration, undermining the backend's own posture. The
// only exception is a client-side validation error (invalid email shape),
// which never reaches the network at all.
"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Label } from "@repo/ui";
import { RequestPasswordResetRequestSchema, type RequestPasswordResetRequest } from "@repo/types";

import { AuthSplitLayout } from "../../components/auth/auth-split-layout";
import { useRequestPasswordReset } from "../../hooks/use-request-password-reset";

const GENERIC_CONFIRMATION = "If that email exists, we've sent a reset link. Check your inbox (and spam folder).";

export default function ForgotPasswordPage(): React.JSX.Element {
  const resetRequest = useRequestPasswordReset();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestPasswordResetRequest>({
    resolver: zodResolver(RequestPasswordResetRequestSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit((values) => {
    resetRequest.mutate(values);
  });

  const busy = isSubmitting || resetRequest.isPending;
  // Settled (success OR error) -> same neutral confirmation, see file header.
  const submitted = resetRequest.isSuccess || resetRequest.isError;

  return (
    <AuthSplitLayout
      data-testid="forgot-password-card"
      title="Reset your password"
      description="Enter the email you use to sign in and we'll send you a reset link."
      footer={
        <p className="text-center text-sm text-fg-muted">
          <Link href="/login" className="font-medium text-fg underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      {submitted ? (
        <p role="status" data-testid="forgot-password-confirmation" className="text-sm text-success">
          {GENERIC_CONFIRMATION}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="forgot-password-email">Email</Label>
            <Input
              id="forgot-password-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="username"
              autoFocus
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "forgot-password-email-error" : undefined}
              {...register("email")}
            />
            {errors.email ? (
              <p id="forgot-password-email-error" role="alert" className="text-sm text-danger">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={busy}
            aria-busy={busy}
            data-testid="forgot-password-submit"
          >
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthSplitLayout>
  );
}
