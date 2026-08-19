// Forgot-password form (`/forgot-password`) — QA defect #5 fix: staff had no
// path into the password-reset flow. RHF + zod resolver against
// RequestPasswordResetRequestSchema (@repo/types), same idiom as LoginForm.
//
// ENUMERATION RESISTANCE: POST /auth/password-reset/request ALWAYS returns 200
// with an identical generic message whether or not the email exists (see
// apps/api/src/modules/auth/password-reset.service.ts) — including when it
// silently declines to send. The account-existence signal is erased server-side,
// on the one axis that carries it.
//
// A NON-200 therefore says nothing about the account: it means the request never
// got as far as looking one up. We surface those (as one flat message, never the
// server's own error string), because reporting "sent" for a request the server
// rejected is how a real outage stays invisible — see the LMS twin of this file.
// Client-side validation errors never reach the network at all.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@repo/ui";
import { RequestPasswordResetRequestSchema, type RequestPasswordResetRequest } from "@repo/types";

import { useRequestPasswordReset } from "../../hooks/use-request-password-reset";
import { AuthLayout } from "./auth-layout";

const GENERIC_CONFIRMATION = "If that email exists, we've sent a reset link. Check your inbox (and spam folder).";

export function ForgotPasswordForm(): React.JSX.Element {
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
    // Hard-code the CRM audience so the emailed reset link points at the CRM's own
    // /reset-password route (not the LMS default). Mirrors LoginForm's audience.
    resetRequest.mutate({ ...values, audience: "crm" });
  });

  const busy = isSubmitting || resetRequest.isPending;
  const submitted = resetRequest.isSuccess;
  const failed = resetRequest.isError;

  return (
    <AuthLayout>
      <Card className="auth-card w-full" data-testid="forgot-password-card">
        <CardHeader className="items-center text-center">
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>Enter your staff email and we&apos;ll send you a reset link.</CardDescription>
        </CardHeader>
        <CardContent>
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
                  placeholder="you@stimuliiq.com"
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

          <p className="mt-4 text-center text-sm text-fg-muted">
            <Link to="/" className="font-medium text-fg underline-offset-4 hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
