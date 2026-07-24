// Student login page (/login) — the destination every signed-out empty state
// links to (`<a href="/login">Sign in</a>`). Controlled-form idiom matching the
// LMS's other forms (assignment/assessment submit): useState + a manual
// LoginRequestSchema.safeParse (the same @repo/types schema the API validates
// against). On success we redirect to the post-login target (`?next=` when
// present, else the dashboard).
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { LoginRequestSchema } from "@repo/types";

import { AuthSplitLayout } from "../../components/auth/auth-split-layout";
import { useLogin } from "../../hooks/use-login";

// Only allow same-origin relative paths as a post-login redirect target so a
// crafted `?next=https://evil.example` can't turn login into an open redirect.
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export default function LoginPage(): React.JSX.Element {
  return (
    <React.Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginFallback(): React.JSX.Element {
  return (
    <AuthSplitLayout busy title="Welcome back" description="Loading…">
      {null}
    </AuthSplitLayout>
  );
}

function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{ email?: string; password?: string }>({});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = LoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: flat.email?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    login.mutate(parsed.data, {
      onSuccess: () => {
        router.replace(safeNext(searchParams.get("next")));
        router.refresh();
      },
    });
  };

  const submitError =
    login.error instanceof ApiError
      ? login.error.isUnauthenticated
        ? "Incorrect email or password."
        : (login.error.problem.detail ?? login.error.problem.title)
      : login.error
        ? "Something went wrong. Please try again."
        : null;

  const busy = login.isPending || login.isSuccess;
  // Redirected here from /reset-password?token=... after a successful reset
  // (QA defect #5 fix) — a one-time banner, not persisted state.
  const resetSuccess = searchParams.get("reset") === "success";

  return (
    <AuthSplitLayout
      data-testid="login-card"
      title="Welcome back"
      description="Sign in to access your courses, progress, and certificates."
    >
      {resetSuccess ? (
        <p role="status" data-testid="login-reset-success" className="mb-4 text-sm text-success">
          Your password has been reset. Sign in with your new password.
        </p>
      ) : null}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p id="login-email-error" role="alert" className="text-sm text-danger">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            <Link
              href="/forgot-password"
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
          />
          {fieldErrors.password ? (
            <p id="login-password-error" role="alert" className="text-sm text-danger">
              {fieldErrors.password}
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
    </AuthSplitLayout>
  );
}
