// Component + a11y tests for TwoFactorPanel (R12, docs/plans/phase-9-completion.md
// T41, crm test infrastructure). Exercises the full enrol -> verify -> enabled ->
// disable lifecycle purely at the component level (apiClient is mocked, the REAL
// end-to-end 2FA lifecycle against a live API is covered by
// apps/api/test/integration/phase-9-auth-lifecycle.integration-spec.ts).

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

import { TwoFactorPanel } from "./two-factor-panel";

const statusMock = vi.fn();
const enrollMock = vi.fn();
const verifyEnrollMock = vi.fn();
const disableMock = vi.fn();

vi.mock("../../lib/api-client", () => ({
  apiClient: {
    auth: {
      twoFactor: {
        status: (...args: unknown[]) => statusMock(...args),
        enroll: (...args: unknown[]) => enrollMock(...args),
        verifyEnroll: (...args: unknown[]) => verifyEnrollMock(...args),
        disable: (...args: unknown[]) => disableMock(...args),
      },
    },
  },
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TwoFactorPanel />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  statusMock.mockReset();
  enrollMock.mockReset();
  verifyEnrollMock.mockReset();
  disableMock.mockReset();
});

describe("TwoFactorPanel, disabled state", () => {
  it("shows the enable button when 2FA is not enabled", async () => {
    statusMock.mockResolvedValue({ enabled: false, remainingBackupCodes: null });
    renderPanel();
    expect(await screen.findByTestId("two-factor-disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable two-factor authentication/i })).toBeInTheDocument();
  });

  it("has no detectable a11y violations in the disabled state", async () => {
    statusMock.mockResolvedValue({ enabled: false, remainingBackupCodes: null });
    const { container } = renderPanel();
    await screen.findByTestId("two-factor-disabled");
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe("TwoFactorPanel, enrol -> verify lifecycle", () => {
  it("enroll shows the secret/otpauth fields and a 6-digit code input; verify with a bad code surfaces an error without crashing", async () => {
    const user = userEvent.setup();
    statusMock.mockResolvedValue({ enabled: false, remainingBackupCodes: null });
    enrollMock.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/Stimuli IQ:me?secret=JBSWY3DPEHPK3PXP&issuer=Stimuli IQ" });
    verifyEnrollMock.mockRejectedValue(new Error("Invalid code"));

    renderPanel();
    await user.click(await screen.findByRole("button", { name: /enable two-factor authentication/i }));

    expect(await screen.findByTestId("two-factor-enrolling")).toBeInTheDocument();
    expect(screen.getByTestId("two-factor-secret")).toHaveValue("JBSWY3DPEHPK3PXP");

    const codeInput = screen.getByTestId("two-factor-verify-code-input");
    await user.type(codeInput, "000000");
    await user.click(screen.getByTestId("two-factor-verify-button"));

    await waitFor(() => expect(verifyEnrollMock).toHaveBeenCalledWith({ code: "000000" }));
    // The component must not crash/unmount on a rejected mutation, still on the
    // enrolling screen so the user can retry.
    expect(screen.getByTestId("two-factor-enrolling")).toBeInTheDocument();
  });

  it("a successful verify shows the one-time backup codes screen", async () => {
    const user = userEvent.setup();
    statusMock.mockResolvedValue({ enabled: false, remainingBackupCodes: null });
    enrollMock.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/Stimuli IQ:me?secret=JBSWY3DPEHPK3PXP&issuer=Stimuli IQ" });
    verifyEnrollMock.mockResolvedValue({ enabled: true, backupCodes: ["aaaa1111", "bbbb2222"] });

    renderPanel();
    await user.click(await screen.findByRole("button", { name: /enable two-factor authentication/i }));
    await user.type(await screen.findByTestId("two-factor-verify-code-input"), "123456");
    await user.click(screen.getByTestId("two-factor-verify-button"));

    const backupScreen = await screen.findByTestId("two-factor-backup-codes");
    expect(backupScreen).toHaveTextContent("aaaa1111");
    expect(backupScreen).toHaveTextContent("bbbb2222");
  });
});

describe("TwoFactorPanel, enabled state", () => {
  it("shows the disable form with the remaining-backup-codes count, and disable requires a non-empty code", async () => {
    statusMock.mockResolvedValue({ enabled: true, remainingBackupCodes: 7 });
    renderPanel();

    const enabledScreen = await screen.findByTestId("two-factor-enabled");
    expect(enabledScreen).toHaveTextContent("7 backup codes remaining");
    expect(screen.getByTestId("two-factor-disable-button")).toBeDisabled(); // empty code
  });

  it("has no detectable a11y violations in the enabled state", async () => {
    statusMock.mockResolvedValue({ enabled: true, remainingBackupCodes: 3 });
    const { container } = renderPanel();
    await screen.findByTestId("two-factor-enabled");
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe("TwoFactorPanel, error state", () => {
  it("shows an alert when the status fetch fails", async () => {
    statusMock.mockRejectedValue(new Error("network error"));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load your two-factor status/i);
  });
});
