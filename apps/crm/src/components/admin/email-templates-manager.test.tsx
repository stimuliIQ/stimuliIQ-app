// Admin ▸ Automatic Emails.
//
// The risk this screen carries is not a broken form, it is a save that reaches real
// students. So what is pinned here is the guarding: a reader without `settings.edit` gets no
// controls, a placeholder the email does not supply blocks the save rather than shipping
// literal braces, and restoring the default asks first.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@repo/ui";
import type { EmailTemplate, MeResponse, PermissionGrant } from "@repo/types";

import { EmailTemplatesManager } from "./email-templates-manager";

const useEmailTemplatesMock = vi.fn();
const useEmailTemplatePreviewMock = vi.fn();
const updateMutate = vi.fn();
const resetMutate = vi.fn();

vi.mock("../../hooks/use-email-templates", () => ({
  useEmailTemplates: (...args: unknown[]) => useEmailTemplatesMock(...args),
  useEmailTemplatePreview: (...args: unknown[]) => useEmailTemplatePreviewMock(...args),
  useUpdateEmailTemplate: () => ({ mutate: updateMutate, isPending: false }),
  useResetEmailTemplate: () => ({ mutate: resetMutate, isPending: false }),
}));

const WELCOME: EmailTemplate = {
  key: "enrollment_welcome",
  name: "Enrolment welcome",
  description: "Sent the first time a student's payment is recorded.",
  subject: "Welcome aboard! Your LMS login is inside",
  heading: "You're Enrolled!",
  body: "Welcome aboard, {{studentName}}! Your learning account is ready.",
  footnote: "Please don't share these details with anyone.",
  variables: [{ key: "studentName", description: "The student's name.", sample: "Chandra Sekhar" }],
  fixedPartsNote: "The LMS username, the temporary password and the sign-in button are added automatically.",
  isCustomised: false,
  updatedAt: null,
};

const RECEIPT: EmailTemplate = {
  ...WELCOME,
  key: "payment_receipt",
  name: "Payment receipt",
  description: "Sent for a payment by a student who already has an account.",
  isCustomised: true,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function me(keys: string[]): MeResponse {
  const permissions: PermissionGrant[] = keys.map((key) => ({ key, scope: "all" }) as PermissionGrant);
  return { permissions } as unknown as MeResponse;
}

function renderManager(permissionKeys: string[]) {
  return render(
    <ToastProvider>
      <EmailTemplatesManager me={me(permissionKeys)} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  useEmailTemplatesMock.mockReset();
  useEmailTemplatePreviewMock.mockReset();
  updateMutate.mockReset();
  resetMutate.mockReset();
  useEmailTemplatesMock.mockReturnValue({
    data: [WELCOME, RECEIPT],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useEmailTemplatePreviewMock.mockReturnValue({
    data: { subject: WELCOME.subject, html: "<html><body>preview</body></html>" },
    isLoading: false,
    isError: false,
    error: null,
  });
});

describe("EmailTemplatesManager", () => {
  it("opens on the first email rather than making the reader pick one", () => {
    renderManager(["settings.view", "settings.edit"]);
    expect(screen.getByTestId("email-template-subject")).toHaveValue(WELCOME.subject);
  });

  // Whether these are the company's words or the ones the product shipped with is the first
  // thing somebody opening this screen needs to know.
  it("says which emails have been customised and which are still the default", () => {
    renderManager(["settings.view"]);
    expect(within(screen.getByTestId("email-template-tab-enrollment_welcome")).getByText("Default")).toBeInTheDocument();
    expect(within(screen.getByTestId("email-template-tab-payment_receipt")).getByText("Customised")).toBeInTheDocument();
  });

  // The server is the boundary, but a form that looks editable and then 403s on save is a
  // bug of its own — and this one would be discovered after somebody rewrote an email.
  it("gives a settings.view reader no save or reset controls", () => {
    renderManager(["settings.view"]);
    expect(screen.getByTestId("email-templates-readonly")).toBeInTheDocument();
    expect(screen.queryByTestId("email-template-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("email-template-reset")).not.toBeInTheDocument();
    expect(screen.getByTestId("email-template-subject")).toBeDisabled();
  });

  it("states which parts of the email cannot be edited here", () => {
    renderManager(["settings.view"]);
    expect(screen.getByTestId("email-template-fixed-parts")).toHaveTextContent(/temporary password/i);
  });

  it("keeps save disabled until something actually changes", async () => {
    renderManager(["settings.view", "settings.edit"]);
    expect(screen.getByTestId("email-template-save")).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByTestId("email-template-subject"), "!");
    expect(screen.getByTestId("email-template-save")).toBeEnabled();
  });

  // The one that matters most: the renderer leaves an unknown placeholder exactly as typed,
  // so saving this would send "{{studnetName}}" to a student.
  it("blocks the save and warns when the text uses a placeholder this email does not supply", () => {
    renderManager(["settings.view", "settings.edit"]);

    const body = screen.getByTestId("email-template-body");
    fireEvent.change(body, { target: { value: "Hi {{studnetName}}, welcome." } });

    expect(screen.getByTestId("email-template-unknown-variable")).toHaveTextContent("{{studnetName}}");
    expect(screen.getByTestId("email-template-save")).toBeDisabled();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("saves the edited wording when the placeholders are valid", async () => {
    const user = userEvent.setup();
    renderManager(["settings.view", "settings.edit"]);

    const body = screen.getByTestId("email-template-body");
    fireEvent.change(body, { target: { value: "Hi {{studentName}}, you are in." } });
    await user.click(screen.getByTestId("email-template-save"));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      key: "enrollment_welcome",
      body: expect.objectContaining({ body: "Hi {{studentName}}, you are in." }),
    });
  });

  it("offers restore only on a customised email, and asks before discarding the edit", async () => {
    const user = userEvent.setup();
    renderManager(["settings.view", "settings.edit"]);

    // The default one has nothing to restore.
    expect(screen.queryByTestId("email-template-reset")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("email-template-tab-payment_receipt"));
    await user.click(screen.getByTestId("email-template-reset"));

    expect(resetMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("confirm-reset-email-template")).toBeInTheDocument();
  });
});
