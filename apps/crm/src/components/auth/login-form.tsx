// Staff login form — rendered by AppShell's signed-out state. RHF + zod
// resolver against LoginRequestSchema (@repo/types), same source of truth the
// API validates against. On success, useLogin invalidates the `me` query and
// the shell re-renders into the authenticated app (no navigation needed — the
// shell gates the whole SPA on `me`).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { LoginRequestSchema, type LoginRequest } from "@repo/types";

import { useLogin } from "../../hooks/use-login";
import { AuthLayout } from "./auth-layout";

export function LoginForm(): React.JSX.Element {
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    login.mutate(values);
  });

  // 401 → wrong email/password; anything else → a generic transient failure.
  const submitError =
    login.error instanceof ApiError
      ? login.error.isUnauthenticated
        ? "Incorrect email or password."
        : (login.error.problem.detail ?? login.error.problem.title)
      : login.error
        ? "Something went wrong. Please try again."
        : null;

  const busy = isSubmitting || login.isPending;

  return (
    <AuthLayout>
      <Card className="auth-card w-full" data-testid="login-card">
        <CardHeader className="items-center text-center">
          <CardTitle>Sign in to Stimuli IQ admin</CardTitle>
          <CardDescription>Use your staff account to access the admin dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="you@stimuliiq.com"
                autoComplete="username"
                autoFocus
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "login-email-error" : undefined}
                {...register("email")}
              />
              {errors.email ? (
                <p id="login-email-error" role="alert" className="text-sm text-danger">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Password</Label>
                <Link
                  to="/forgot-password"
                  data-testid="login-forgot-password-link"
                  className="text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="login-password"
                placeholder="Enter your password"
                autoComplete="current-password"
                toggleTestId="login-password-toggle"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "login-password-error" : undefined}
                {...register("password")}
              />
              {errors.password ? (
                <p id="login-password-error" role="alert" className="text-sm text-danger">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            {submitError ? (
              <p role="alert" data-testid="login-error" className="text-sm text-danger">
                {submitError}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy} aria-busy={busy} data-testid="login-submit">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
