// Staff login form — rendered by AppShell's signed-out state. RHF + zod
// resolver against LoginRequestSchema (@repo/types), same source of truth the
// API validates against. On success, useLogin invalidates the `me` query and
// the shell re-renders into the authenticated app (no navigation needed — the
// shell gates the whole SPA on `me`).
//
// TWO-FACTOR: POST /auth/login never issues a session to a 2FA-enrolled account — it
// refuses with `auth.2fa_required` and the client must complete POST
// /auth/2fa/login-verify (see apps/api/src/modules/auth/auth.controller.ts). This form
// therefore runs a small stage machine rather than a single submit:
//
//   credentials ──(auth.2fa_required)──> totp ──(verified)──> signed in
//                                          │
//                                          └──(lost authenticator)──> recovery-request
//                                                                       └──> recovery-code
//                                                                              └──> credentials
//
// Until this existed, enrolling in 2FA locked a user out permanently: `auth.2fa_required`
// is an HTTP 401, the catch-all below rendered every 401 as "Incorrect email or
// password", and there was no code field anywhere in the app. Keep the code-specific
// branch AHEAD of the generic `isUnauthenticated` check.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, PasswordInput } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import { LoginRequestSchema, type LoginRequest } from "@repo/types";

import { useLogin } from "../../hooks/use-login";
import {
  useConfirmTwoFactorRecovery,
  useRequestTwoFactorRecovery,
  useTwoFactorLoginVerify,
} from "../../hooks/use-two-factor-login";
import { AuthLayout } from "./auth-layout";

type Stage = "credentials" | "totp" | "recovery-request" | "recovery-code";

/** Extracts a displayable message from an unknown mutation error. */
function errorMessage(error: unknown, unauthenticatedFallback: string): string | null {
  if (error instanceof ApiError) {
    return error.problem.detail ?? error.problem.title ?? unauthenticatedFallback;
  }
  return error ? "Something went wrong. Please try again." : null;
}

export function LoginForm(): React.JSX.Element {
  const login = useLogin();
  const loginVerify = useTwoFactorLoginVerify();
  const requestRecovery = useRequestTwoFactorRecovery();
  const confirmRecovery = useConfirmTwoFactorRecovery();

  const [stage, setStage] = React.useState<Stage>("credentials");
  // Held in memory only for the length of the sign-in attempt: /auth/2fa/login-verify and
  // both recovery endpoints re-verify the password server-side, so the client has to be
  // able to present it again. Cleared whenever we return to the credentials stage.
  const [credentials, setCredentials] = React.useState<LoginRequest | null>(null);
  const [code, setCode] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

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

  const onSubmitCredentials = handleSubmit(async (values) => {
    setNotice(null);
    try {
      await login.mutateAsync(values);
    } catch (error) {
      // The ONLY 401 that isn't a bad password: the account is 2FA-enrolled and the
      // server is asking for the second factor. Anything else falls through to the
      // generic message rendered below.
      if (error instanceof ApiError && error.problem.code === "auth.2fa_required") {
        setCredentials(values);
        setCode("");
        setStage("totp");
      }
    }
  });

  async function onSubmitTotp(event: React.FormEvent) {
    event.preventDefault();
    if (!credentials) return;
    try {
      await loginVerify.mutateAsync({ ...credentials, code: code.trim() });
      // Success needs no navigation — AppShell gates the SPA on `me`, which the
      // mutation has just invalidated.
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
    const busy = isSubmitting || login.isPending;

    return (
      <AuthLayout>
        {/* `key` per stage: every stage renders the same AuthLayout > Card > form > Input
            shape, so without it React reconciles the RHF-registered (uncontrolled) email
            field into the next stage's controlled code field and warns about switching
            an input from uncontrolled to controlled. */}
        <Card key="credentials" className="auth-card w-full" data-testid="login-card">
          <CardHeader className="items-center text-center">
            <CardTitle>Sign in to Stimuli IQ admin</CardTitle>
            <CardDescription>Use your staff account to access the admin dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            {notice ? (
              <Alert tone="success" className="mb-4" data-testid="login-notice">
                {notice}
              </Alert>
            ) : null}
            <form onSubmit={onSubmitCredentials} noValidate className="space-y-4">
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

  // ─── totp (second factor) ────────────────────────────────────────────────
  if (stage === "totp") {
    const verifyError = errorMessage(loginVerify.error, "That code didn't work.");
    return (
      <AuthLayout>
        <Card key="totp" className="auth-card w-full" data-testid="login-2fa-card">
          <CardHeader className="items-center text-center">
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              Enter the 6-digit code from your authenticator app, or one of your backup codes.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  // ─── recovery: request a code ────────────────────────────────────────────
  if (stage === "recovery-request") {
    const requestError = errorMessage(requestRecovery.error, "Couldn't send a recovery code.");
    return (
      <AuthLayout>
        <Card key="recovery-request" className="auth-card w-full" data-testid="login-recovery-request-card">
          <CardHeader className="items-center text-center">
            <CardTitle>Lost your authenticator?</CardTitle>
            <CardDescription>
              We can email a single-use code to the address on your account. Using it turns two-factor
              authentication off so you can sign in with your password and enrol a new device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="warning" data-testid="login-recovery-warning">
              This removes a layer of protection from your account. Set up your authenticator app again as soon
              as you are back in.
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
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  // ─── recovery: enter the emailed code ────────────────────────────────────
  const confirmError = errorMessage(confirmRecovery.error, "That recovery code is invalid or has expired.");
  return (
    <AuthLayout>
      <Card key="recovery-code" className="auth-card w-full" data-testid="login-recovery-code-card">
        <CardHeader className="items-center text-center">
          <CardTitle>Enter your recovery code</CardTitle>
          {/* Deliberately hedged ("if … exists"): the API's response is identical whether
              or not the account exists, has 2FA, or gave the right password. Promising
              "we sent an email" here would leak what the API is careful not to. */}
          <CardDescription>
            If an account exists for that email with two-factor authentication enabled, a 6-digit code is on its
            way. It expires in 15 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
