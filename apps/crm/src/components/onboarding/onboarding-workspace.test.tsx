// Component tests for the Onboarding CRM screen. Mocks the data hooks directly (CLAUDE.md
// §3.3: components hold no business logic, so these are rendering/gating tests).
//
// The gating case is the one that matters most here: `onboarding.fields.manage` is a
// SEPARATE permission from the submission ones precisely so someone working the intake
// queue can't quietly delete the payment-receipt question out of the live form. If that
// tab ever renders for a submissions-only role, the separation has silently collapsed.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { MeResponse, OnboardingField, OnboardingSubmissionSummary } from "@repo/types";
import { ToastProvider } from "@repo/ui";

import { OnboardingWorkspace } from "./onboarding-workspace";

const useOnboardingSubmissionsMock = vi.fn();
const useOnboardingFieldsMock = vi.fn();
const useOnboardingSubmissionMock = vi.fn();
const useDeleteOnboardingSubmissionMock = vi.fn();
const useUpdateOnboardingSubmissionMock = vi.fn();
const useDeleteOnboardingFieldMock = vi.fn();
const useReorderOnboardingFieldsMock = vi.fn();
const useCreateOnboardingFieldMock = vi.fn();
const useUpdateOnboardingFieldMock = vi.fn();

vi.mock("../../hooks/use-onboarding", () => ({
  useOnboardingSubmissions: (...args: unknown[]) => useOnboardingSubmissionsMock(...args),
  useOnboardingSubmission: (...args: unknown[]) => useOnboardingSubmissionMock(...args),
  useOnboardingFields: (...args: unknown[]) => useOnboardingFieldsMock(...args),
  useDeleteOnboardingSubmission: (...args: unknown[]) => useDeleteOnboardingSubmissionMock(...args),
  useUpdateOnboardingSubmission: (...args: unknown[]) => useUpdateOnboardingSubmissionMock(...args),
  useDeleteOnboardingField: (...args: unknown[]) => useDeleteOnboardingFieldMock(...args),
  useReorderOnboardingFields: (...args: unknown[]) => useReorderOnboardingFieldsMock(...args),
  useCreateOnboardingField: (...args: unknown[]) => useCreateOnboardingFieldMock(...args),
  useUpdateOnboardingField: (...args: unknown[]) => useUpdateOnboardingFieldMock(...args),
}));

const BASE_ME: MeResponse = {
  user: {
    id: "u-1",
    email: "admin@stimuliiq.test",
    name: "Admin",
    phone: null,
    avatar: null,
    status: "active",
    mustChangePassword: false,
  },
  tenantId: "t-1",
  roles: ["super_admin"],
  permissions: [],
};

const FULL_ACCESS_ME: MeResponse = {
  ...BASE_ME,
  permissions: [
    { key: "onboarding.view", scope: "all" },
    { key: "onboarding.edit", scope: "all" },
    { key: "onboarding.delete", scope: "all" },
    { key: "onboarding.fields.manage", scope: "all" },
  ],
};

/** A counsellor: works the queue, but must not be able to edit the form itself. */
const QUEUE_ONLY_ME: MeResponse = {
  ...BASE_ME,
  roles: ["counsellor"],
  permissions: [
    { key: "onboarding.view", scope: "all" },
    { key: "onboarding.edit", scope: "all" },
  ],
};

const SUBMISSION: OnboardingSubmissionSummary = {
  id: "sub-1",
  fullName: "Ananya Sharma",
  email: "ananya@example.com",
  phone: "+919876543210",
  programId: "program-1",
  programTitle: "Clinical Neurology Fellowship",
  status: "pending",
  studentProfileId: null,
  hasAttachment: true,
  reviewedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const FIELD: OnboardingField = {
  id: "field-1",
  key: "payment_receipt",
  label: "Payment Receipt",
  helpText: null,
  placeholder: null,
  type: "file",
  required: true,
  options: null,
  allowOther: false,
  identityRole: "none",
  sortOrder: 8,
  active: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function renderWorkspace(me: MeResponse | undefined = FULL_ACCESS_ME) {
  return render(
    <ToastProvider>
      <OnboardingWorkspace me={me} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  useOnboardingSubmissionsMock.mockReturnValue({
    data: { items: [SUBMISSION], meta: { page: 1, pageSize: 25, total: 1, hasMore: false } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useOnboardingFieldsMock.mockReturnValue({ data: [FIELD], isLoading: false, isError: false, refetch: vi.fn() });
  useOnboardingSubmissionMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  useDeleteOnboardingSubmissionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useUpdateOnboardingSubmissionMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useDeleteOnboardingFieldMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useReorderOnboardingFieldsMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCreateOnboardingFieldMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdateOnboardingFieldMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("OnboardingWorkspace — submissions list", () => {
  it("renders a submission with its identity columns and program", () => {
    renderWorkspace();
    expect(screen.getByTestId("onboarding-submissions-table")).toBeInTheDocument();
    expect(screen.getByText("Ananya Sharma")).toBeInTheDocument();
    expect(screen.getByText("ananya@example.com")).toBeInTheDocument();
    expect(screen.getByText("Clinical Neurology Fellowship")).toBeInTheDocument();
  });

  it("marks rows that carry an attachment so staff can spot a missing receipt at a glance", () => {
    renderWorkspace();
    expect(screen.getByLabelText("Has an attachment")).toBeInTheDocument();
  });

  it("shows an error state with a retry action when the list fails to load", () => {
    useOnboardingSubmissionsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderWorkspace();
    expect(screen.getByTestId("onboarding-submissions-error")).toBeInTheDocument();
  });
});

describe("OnboardingWorkspace — RBAC gating", () => {
  it("shows the Form fields tab to a user holding onboarding.fields.manage", () => {
    renderWorkspace(FULL_ACCESS_ME);
    expect(screen.getByRole("tab", { name: "Form fields" })).toBeInTheDocument();
  });

  it("hides the Form fields tab from a submissions-only role", () => {
    renderWorkspace(QUEUE_ONLY_ME);
    expect(screen.queryByRole("tab", { name: "Form fields" })).not.toBeInTheDocument();
  });

  it("hides the per-row delete button without onboarding.delete", () => {
    renderWorkspace(QUEUE_ONLY_ME);
    expect(screen.queryByTestId(`delete-onboarding-${SUBMISSION.id}`)).not.toBeInTheDocument();
  });
});

describe("OnboardingWorkspace — form fields tab", () => {
  it("lists the questions with their key and type, and offers Add question", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Form fields" }));

    expect(await screen.findByTestId("onboarding-fields-table")).toBeInTheDocument();
    expect(screen.getByText("Payment Receipt")).toBeInTheDocument();
    expect(screen.getByText("payment_receipt")).toBeInTheDocument();
    expect(screen.getByText("File upload")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-field-create")).toBeInTheDocument();
  });

  it("confirms before removing a question, and says answers already collected are kept", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Form fields" }));
    await user.click(await screen.findByTestId(`delete-onboarding-field-${FIELD.key}`));

    expect(await screen.findByTestId("confirm-delete-onboarding-field")).toBeInTheDocument();
    expect(screen.getByText(/Answers already collected for it stay/)).toBeInTheDocument();
  });
});

describe("OnboardingWorkspace — a11y", () => {
  it("has no detectable a11y violations with a populated list", async () => {
    const { container } = renderWorkspace();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
