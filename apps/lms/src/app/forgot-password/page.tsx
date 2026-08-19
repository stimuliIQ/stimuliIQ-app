// Forgot-password page (/forgot-password) — QA defect #5 fix: the login page
// had no path into the password-reset flow. RHF + zodResolver against
// RequestPasswordResetRequestSchema (@repo/types), the same schema the API
// validates against — matches the LoginForm idiom in ../login/page.tsx.
//
// ENUMERATION RESISTANCE: POST /auth/password-reset/request ALWAYS returns 200
// with an identical generic message whether or not the email exists (see
// apps/api/src/modules/auth/password-reset.service.ts) — including when it
// silently declines to send (rate-limited bucket, mail-provider failure). The
// account-existence signal is therefore already erased server-side, on the ONE
// axis that carries it.
//
// So a NON-200 says nothing about the account: it means the request never got
// as far as looking one up. We surface those, because reporting "sent" for a
// request the server rejected is how a real outage stays invisible — a 403
// from the must-change-password gate silently swallowed every reset request
// from a signed-in student for weeks, and this screen cheerfully said "check
// your inbox" each time. Client-side validation errors (invalid email shape)
// still never reach the network at all.
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
  const submitted = resetRequest.isSuccess;
  // Never echo a server error string here — a bespoke message per status code would
  // put the enumeration surface back. One flat "we couldn't process it, retry" for
  // every failure, which is all the student can act on anyway.
  const failed = resetRequest.isError;

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

          {failed ? (
            <p role="alert" data-testid="forgot-password-error" className="text-sm text-danger">
              We couldn&apos;t send the reset link just now. Please try again in a moment.
            </p>
          ) : null}

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
