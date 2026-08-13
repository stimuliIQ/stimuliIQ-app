// Student login page (/login) — the destination every signed-out empty state
// links to (`<a href="/login">Sign in</a>`). Controlled-form idiom matching the
// LMS's other forms (assignment/assessment submit): useState + a manual
// LoginRequestSchema.safeParse (the same @repo/types schema the API validates
// against). On success we redirect to the post-login target (`?next=` when
// present, else the dashboard).
//
// TWO-FACTOR: POST /auth/login never issues a session to a 2FA-enrolled account — it
// refuses with `auth.2fa_required` and the client must complete POST
// /auth/2fa/login-verify (see apps/api/src/modules/auth/auth.controller.ts). This page
// therefore runs a small stage machine rather than a single submit, porting the pattern
// already shipped in apps/crm/src/components/auth/login-form.tsx:
//
//   credentials ──(auth.2fa_required)──> totp ──(verified)──> signed in
//                                          │
//                                          └──(lost authenticator)──> recovery-request
//                                                                       └──> recovery-code
//                                                                              └──> credentials
//
// Until this existed, a student enrolling in 2FA was locked out permanently:
// `auth.2fa_required` is an HTTP 401, the catch-all below rendered every 401 as
// "Incorrect email or password", and there was no code field anywhere in this app. Keep
// the code-specific branch AHEAD of the generic `isUnauthenticated` check.
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Input, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { LoginRequestSchema, type LoginRequest } from "@repo/types";

import { AuthSplitLayout } from "../../components/auth/auth-split-layout";
import { useLogin } from "../../hooks/use-login";
import {
  useConfirmTwoFactorRecovery,
  useRequestTwoFactorRecovery,
  useTwoFactorLoginVerify,
} from "../../hooks/use-two-factor-login";

// Only allow same-origin relative paths as a post-login redirect target so a
// crafted `?next=https://evil.example` can't turn login into an open redirect.
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

type Stage = "credentials" | "totp" | "recovery-request" | "recovery-code";

/** Extracts a displayable message from an unknown mutation error. */
function errorMessage(error: unknown, unauthenticatedFallback: string): string | null {
  if (error instanceof ApiError) {
    return error.problem.detail ?? error.problem.title ?? unauthenticatedFallback;
  }
  return error ? "Something went wrong. Please try again." : null;
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
  const loginVerify = useTwoFactorLoginVerify();
  const requestRecovery = useRequestTwoFactorRecovery();
  const confirmRecovery = useConfirmTwoFactorRecovery();

  const [stage, setStage] = React.useState<Stage>("credentials");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<{ email?: string; password?: string }>({});
  // Held in memory only for the length of the sign-in attempt: /auth/2fa/login-verify and
  // both recovery endpoints re-verify the password server-side, so the client has to be
  // able to present it again. Cleared whenever we return to the credentials stage.
  const [credentials, setCredentials] = React.useState<LoginRequest | null>(null);
  const [code, setCode] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);

  function goToPostLogin() {
    router.replace(safeNext(searchParams.get("next")));
    router.refresh();
  }

  function backToCredentials(message?: string) {
    setStage("credentials");
    setCredentials(null);
    setCode("");
    setNotice(message ?? null);
    login.reset();
    loginVerify.reset();
    requestRecovery.reset();
    confirmRecovery.reset();
  }

  const handleSubmitCredentials = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = LoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: flat.email?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    setNotice(null);
    login.mutate(parsed.data, {
      onSuccess: goToPostLogin,
      onError: (error) => {
        // The ONLY 401 that isn't a bad password: the account is 2FA-enrolled and the
        // server is asking for the second factor. Anything else falls through to the
        // generic message rendered below.
        if (error instanceof ApiError && error.problem.code === "auth.2fa_required") {
          setCredentials(parsed.data);
          setCode("");
          setStage("totp");
        }
      },
    });
  };

  async function onSubmitTotp(event: React.FormEvent) {
    event.preventDefault();
    if (!credentials) return;
    try {
      await loginVerify.mutateAsync({ ...credentials, code: code.trim() });
      goToPostLogin();
    } catch {
      // Rendered from `loginVerify.error` below.
    }
  }

  async function onRequestRecovery() {
    if (!credentials) return;
    try {
      await requestRecovery.mutateAsync(credentials);
      // ALWAYS a generic success — the response never confirms the account exists or is
      // enrolled, so the UI must not imply an email was definitely sent.
      setCode("");
      setStage("recovery-code");
    } catch {
      // Rendered from `requestRecovery.error` below (transport failures only).
    }
  }

  async function onConfirmRecovery(event: React.FormEvent) {
    event.preventDefault();
    if (!credentials) return;
    try {
      await confirmRecovery.mutateAsync({ ...credentials, code: code.trim() });
      backToCredentials(
        "Two-factor authentication is now off. Sign in with your password, then set up your authenticator app again straight away.",
      );
    } catch {
      // Rendered from `confirmRecovery.error` below.
    }
  }

  // Redirected here from /reset-password?token=... after a successful reset
  // (QA defect #5 fix) — a one-time banner, not persisted state.
  const resetSuccess = searchParams.get("reset") === "success";

  // ─── credentials ─────────────────────────────────────────────────────────
  if (stage === "credentials") {
    const submitError =
      login.error instanceof ApiError
        ? login.error.isUnauthenticated
          ? "Incorrect email or password."
          : (login.error.problem.detail ?? login.error.problem.title)
        : login.error
          ? "Something went wrong. Please try again."
          : null;
    const busy = login.isPending || login.isSuccess;

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
        {notice ? (
          <Alert tone="success" className="mb-4" data-testid="login-notice">
            {notice}
          </Alert>
        ) : null}
        <form onSubmit={handleSubmitCredentials} noValidate className="space-y-4">
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

  // ─── totp (second factor) ────────────────────────────────────────────────
  if (stage === "totp") {
    const verifyError = errorMessage(loginVerify.error, "That code didn't work.");
    return (
      <AuthSplitLayout data-testid="login-2fa-card" title="Two-factor authentication" description="Enter the 6-digit code from your authenticator app, or one of your backup codes.">
        <form onSubmit={onSubmitTotp} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="login-2fa-code">Authentication code</Label>
            <Input
              id="login-2fa-code"
              // Not `type="number"` — backup codes are XXXXX-XXXXX. `one-time-code`
              // lets iOS/Android offer the code straight from the notification.
              inputMode="text"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              data-testid="login-2fa-code-input"
            />
          </div>

          {verifyError ? (
            <p role="alert" data-testid="login-2fa-error" className="text-sm text-danger">
              {verifyError}
            </p>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={loginVerify.isPending || !code.trim()}
            aria-busy={loginVerify.isPending}
            data-testid="login-2fa-submit"
          >
            {loginVerify.isPending ? "Verifying…" : "Verify"}
          </Button>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => backToCredentials()}
              className="text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              data-testid="login-2fa-back"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                requestRecovery.reset();
                setStage("recovery-request");
              }}
              className="text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              data-testid="login-2fa-lost-device"
            >
              Lost your authenticator?
            </button>
          </div>
        </form>
      </AuthSplitLayout>
    );
  }

  // ─── recovery: request a code ────────────────────────────────────────────
  if (stage === "recovery-request") {
    const requestError = errorMessage(requestRecovery.error, "Couldn't send a recovery code.");
    return (
      <AuthSplitLayout
        data-testid="login-recovery-request-card"
        title="Lost your authenticator?"
        description="We can email a single-use code to the address on your account. Using it turns two-factor authentication off so you can sign in with your password and enrol a new device."
      >
        <div className="space-y-4">
          <Alert tone="warning" data-testid="login-recovery-warning">
            This removes a layer of protection from your account. Set up your authenticator app again as soon as you
            are back in.
          </Alert>

          {requestError ? (
            <p role="alert" data-testid="login-recovery-request-error" className="text-sm text-danger">
              {requestError}
            </p>
          ) : null}

          <Button
            type="button"
            className="w-full"
            onClick={onRequestRecovery}
            disabled={requestRecovery.isPending}
            aria-busy={requestRecovery.isPending}
            data-testid="login-recovery-request-submit"
          >
            {requestRecovery.isPending ? "Sending…" : "Email me a recovery code"}
          </Button>
          <button
            type="button"
            onClick={() => setStage("totp")}
            className="w-full text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            data-testid="login-recovery-request-back"
          >
            Back
          </button>
        </div>
      </AuthSplitLayout>
    );
  }

  // ─── recovery: enter the emailed code ────────────────────────────────────
  const confirmError = errorMessage(confirmRecovery.error, "That recovery code is invalid or has expired.");
  return (
    <AuthSplitLayout
      data-testid="login-recovery-code-card"
      title="Enter your recovery code"
      // Deliberately hedged ("if … exists"): the API's response is identical whether or
      // not the account exists, has 2FA, or gave the right password. Promising "we sent
      // an email" here would leak what the API is careful not to.
      description="If an account exists for that email with two-factor authentication enabled, a 6-digit code is on its way. It expires in 15 minutes."
    >
      <form onSubmit={onConfirmRecovery} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-recovery-code">Recovery code</Label>
          <Input
            id="login-recovery-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="login-recovery-code-input"
          />
        </div>

        {confirmError ? (
          <p role="alert" data-testid="login-recovery-code-error" className="text-sm text-danger">
            {confirmError}
          </p>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={confirmRecovery.isPending || !code.trim()}
          aria-busy={confirmRecovery.isPending}
          data-testid="login-recovery-code-submit"
        >
          {confirmRecovery.isPending ? "Turning off 2FA…" : "Turn off two-factor authentication"}
        </Button>
        <button
          type="button"
          onClick={() => backToCredentials()}
          className="w-full text-sm font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          data-testid="login-recovery-code-back"
        >
          Back to sign in
        </button>
      </form>
    </AuthSplitLayout>
  );
}
