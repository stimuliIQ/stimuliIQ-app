// Component + a11y tests for LoginForm's two-factor stages.
//
// REGRESSION ANCHOR: `auth.2fa_required` is an HTTP 401, and this form's catch-all used
// to render every 401 as "Incorrect email or password" — with no code field anywhere in
// the app. Enrolling in 2FA therefore locked a user out permanently. The first test
// below is the one that must never go green-by-accident: it asserts the code step
// appears INSTEAD of the credentials error.
//
// apiClient is mocked; the real server-side gate is covered by
// apps/api/test/integration/phase-9-auth-lifecycle.integration-spec.ts.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import { ApiError } from "@repo/api-client";

import { LoginForm } from "./login-form";

const loginMock = vi.fn();
const loginVerifyMock = vi.fn();
const requestRecoveryMock = vi.fn();
const confirmRecoveryMock = vi.fn();

vi.mock("../../lib/api-client", () => ({
  apiClient: {
    auth: {
      login: (...args: unknown[]) => loginMock(...args),
      twoFactor: {
        loginVerify: (...args: unknown[]) => loginVerifyMock(...args),
        requestRecovery: (...args: unknown[]) => requestRecoveryMock(...args),
        confirmRecovery: (...args: unknown[]) => confirmRecoveryMock(...args),
      },
    },
  },
}));

// The form links to /forgot-password; the router isn't under test here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode; to: string }) => <a href={props.to}>{children}</a>,
}));

function problem(status: number, code: string, title: string) {
  return new ApiError({ status, code, title, type: "about:blank" } as never);
}

const CREDENTIALS = { email: "priya@stimuliiq.com", password: "Sup3rSecret!x" };

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LoginForm />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Fills in email + password and submits the first stage. */
async function submitCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), CREDENTIALS.email);
  await user.type(screen.getByLabelText("Password"), CREDENTIALS.password);
  await user.click(screen.getByTestId("login-submit"));
}

beforeEach(() => {
  loginMock.mockReset();
  loginVerifyMock.mockReset();
  requestRecoveryMock.mockReset();
  confirmRecoveryMock.mockReset();
});

describe("LoginForm — 2FA gate", () => {
  it("shows the code step (NOT a credentials error) when the server answers auth.2fa_required", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(problem(401, "auth.2fa_required", "Two-factor authentication required"));
    renderForm();

    await submitCredentials(user);

    expect(await screen.findByTestId("login-2fa-card")).toBeInTheDocument();
    expect(screen.getByTestId("login-2fa-code-input")).toBeInTheDocument();
    // The lockout bug in one assertion.
    expect(screen.queryByText("Incorrect email or password.")).not.toBeInTheDocument();
  });

  it("still shows the generic message for an ordinary bad-password 401", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(problem(401, "auth.invalid_credentials", "Invalid email or password"));
    renderForm();

    await submitCredentials(user);

    expect(await screen.findByTestId("login-error")).toHaveTextContent("Incorrect email or password.");
    expect(screen.queryByTestId("login-2fa-card")).not.toBeInTheDocument();
  });

  it("re-sends the stashed credentials alongside the code, pinned to the crm audience", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(problem(401, "auth.2fa_required", "Two-factor authentication required"));
    loginVerifyMock.mockResolvedValue({ user: { id: "u1" }, csrfToken: "t" });
    renderForm();

    await submitCredentials(user);
    await user.type(await screen.findByTestId("login-2fa-code-input"), "123456");
    await user.click(screen.getByTestId("login-2fa-submit"));

    await waitFor(() =>
      expect(loginVerifyMock).toHaveBeenCalledWith({ ...CREDENTIALS, code: "123456", audience: "crm" }),
    );
  });

  it("surfaces a wrong code without dropping back to the password step", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(problem(401, "auth.2fa_required", "Two-factor authentication required"));
    loginVerifyMock.mockRejectedValue(problem(401, "TOTP_CODE_INVALID", "Invalid two-factor code"));
    renderForm();

    await submitCredentials(user);
    await user.type(await screen.findByTestId("login-2fa-code-input"), "000000");
    await user.click(screen.getByTestId("login-2fa-submit"));

    expect(await screen.findByTestId("login-2fa-error")).toBeInTheDocument();
    expect(screen.getByTestId("login-2fa-card")).toBeInTheDocument();
  });

  it("has no a11y violations at the code step", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(problem(401, "auth.2fa_required", "Two-factor authentication required"));
    const { container } = renderForm();

    await submitCredentials(user);
    await screen.findByTestId("login-2fa-card");

    // jest-axe's matcher is incompatible with Vitest's expect — assert the violations
    // array directly (see apps/crm/src/test/setup.ts's note).
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe("LoginForm — lost-authenticator recovery", () => {
  async function reachRecoveryRequest(user: ReturnType<typeof userEvent.setup>) {
    loginMock.mockRejectedValue(problem(401, "auth.2fa_required", "Two-factor authentication required"));
    renderForm();
    await submitCredentials(user);
    await user.click(await screen.findByTestId("login-2fa-lost-device"));
  }

  it("requests a code with the stashed credentials, then asks for it", async () => {
    const user = userEvent.setup();
    requestRecoveryMock.mockResolvedValue({ message: "generic" });
    await reachRecoveryRequest(user);

    await user.click(await screen.findByTestId("login-recovery-request-submit"));

    await waitFor(() => expect(requestRecoveryMock).toHaveBeenCalledWith({ ...CREDENTIALS, audience: "crm" }));
    expect(await screen.findByTestId("login-recovery-code-card")).toBeInTheDocument();
  });

  it("never claims an email was definitely sent — the API's response is deliberately ambiguous", async () => {
    const user = userEvent.setup();
    requestRecoveryMock.mockResolvedValue({ message: "generic" });
    await reachRecoveryRequest(user);
    await user.click(await screen.findByTestId("login-recovery-request-submit"));

    const card = await screen.findByTestId("login-recovery-code-card");
    expect(card).toHaveTextContent(/if an account exists/i);
  });

  it("on success returns to the password step with a re-enrol prompt, and issues no session", async () => {
    const user = userEvent.setup();
    requestRecoveryMock.mockResolvedValue({ message: "generic" });
    confirmRecoveryMock.mockResolvedValue({ reset: true });
    await reachRecoveryRequest(user);
    await user.click(await screen.findByTestId("login-recovery-request-submit"));

    await user.type(await screen.findByTestId("login-recovery-code-input"), "654321");
    await user.click(screen.getByTestId("login-recovery-code-submit"));

    await waitFor(() => expect(confirmRecoveryMock).toHaveBeenCalledWith({ ...CREDENTIALS, code: "654321" }));
    // Back to stage one — recovery deliberately does NOT log anyone in.
    expect(await screen.findByTestId("login-notice")).toHaveTextContent(/set up your authenticator app again/i);
    expect(screen.getByTestId("login-card")).toBeInTheDocument();
    expect(loginVerifyMock).not.toHaveBeenCalled();
  });

  it("keeps the user on the code step when the code is rejected", async () => {
    const user = userEvent.setup();
    requestRecoveryMock.mockResolvedValue({ message: "generic" });
    confirmRecoveryMock.mockRejectedValue(problem(422, "RECOVERY_CODE_INVALID", "That recovery code is invalid or has expired"));
    await reachRecoveryRequest(user);
    await user.click(await screen.findByTestId("login-recovery-request-submit"));

    await user.type(await screen.findByTestId("login-recovery-code-input"), "000000");
    await user.click(screen.getByTestId("login-recovery-code-submit"));

    expect(await screen.findByTestId("login-recovery-code-error")).toBeInTheDocument();
    expect(screen.getByTestId("login-recovery-code-card")).toBeInTheDocument();
  });
});
