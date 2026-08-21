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
import type {
  MeResponse,
  OnboardingField,
  OnboardingSubmissionDetail,
  OnboardingSubmissionSummary,
} from "@repo/types";
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
const useOnboardingApprovableBatchesMock = vi.fn();
const useApproveOnboardingSubmissionMock = vi.fn();
const useRejectOnboardingSubmissionMock = vi.fn();

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
  useOnboardingApprovableBatches: (...args: unknown[]) => useOnboardingApprovableBatchesMock(...args),
  useApproveOnboardingSubmission: (...args: unknown[]) => useApproveOnboardingSubmissionMock(...args),
  useRejectOnboardingSubmission: (...args: unknown[]) => useRejectOnboardingSubmissionMock(...args),
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
  programPricePaise: 2_500_000,
  programCurrency: "INR",
  status: "hold", // the arrival state, see migration `onboarding_default_hold`.
  studentProfileId: null,
  hasAttachment: true,
  reviewedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const SUBMISSION_DETAIL: OnboardingSubmissionDetail = {
  ...SUBMISSION,
  answers: [
    {
      fieldId: "field-1",
      key: "payment_receipt",
      label: "Payment Receipt",
      type: "file",
      value: "receipt.png",
      storageKey: "onboarding/t-1/uuid-receipt.png",
    },
  ],
  reviewNotes: null,
  reviewedByName: null,
  attachmentUrls: { "onboarding/t-1/uuid-receipt.png": "https://signed.example.test/receipt" },
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

const APPROVE_RESULT = {
  submission: { ...SUBMISSION_DETAIL, status: "approved" as const },
  activation: {
    studentProfileId: "student-1",
    enrollmentId: "enrol-1",
    batchName: "September 2026 Batch",
    studentCreated: true,
    credentialsEmailed: true,
    invoiceNumber: "INV-2026-0001",
    amountPaise: 2_500_000,
  },
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
  useOnboardingApprovableBatchesMock.mockReturnValue({
    data: [{ id: "batch-1", name: "September 2026 Batch", startDate: null, status: "planned" }],
    isLoading: false,
    isError: false,
  });
  useApproveOnboardingSubmissionMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(APPROVE_RESULT), isPending: false });
  useRejectOnboardingSubmissionMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
});

/** Opens the row's review drawer, which is where both decisions live. */
async function openDrawer() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  useOnboardingSubmissionMock.mockReturnValue({ data: SUBMISSION_DETAIL, isLoading: false, isError: false });
  renderWorkspace();
  await user.click(screen.getByText("Ananya Sharma"));
  await screen.findByTestId("onboarding-submission-drawer");
  return user;
}

describe("OnboardingWorkspace, submissions list", () => {
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

describe("OnboardingWorkspace, RBAC gating", () => {
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

describe("OnboardingWorkspace, form fields tab", () => {
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

// The point of this screen: a submission sits on hold until someone accepts or rejects it,
// and each verb states its consequences before it fires.
describe("OnboardingWorkspace, accept / reject", () => {
  it("offers the two decisions and no status picker", async () => {
    await openDrawer();

    expect(screen.getByTestId("onboarding-accept")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-reject")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-status-select")).not.toBeInTheDocument();
  });

  it("shows an untouched submission as on hold", async () => {
    await openDrawer();
    expect(screen.getAllByText("On hold").length).toBeGreaterThan(0);
  });

  it("names the exact amount it will invoice before accepting", async () => {
    const user = await openDrawer();

    await user.click(screen.getByTestId("onboarding-accept"));

    expect(await screen.findByTestId("onboarding-accept-panel")).toBeInTheDocument();
    expect(screen.getByText(/₹25,000.00/)).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-accept-record-payment")).toBeInTheDocument();
  });

  it("accepts into the only open batch, recording the payment", async () => {
    const approveMock = vi.fn().mockResolvedValue(APPROVE_RESULT);
    useApproveOnboardingSubmissionMock.mockReturnValue({ mutateAsync: approveMock, isPending: false });
    const user = await openDrawer();

    await user.click(screen.getByTestId("onboarding-accept"));
    await user.click(await screen.findByTestId("onboarding-accept-confirm"));

    expect(approveMock).toHaveBeenCalledWith({
      id: "sub-1",
      body: { batchId: "batch-1", recordPayment: true },
    });
  });

  it("lets the reviewer waive the invoice for a scholarship seat", async () => {
    const approveMock = vi.fn().mockResolvedValue(APPROVE_RESULT);
    useApproveOnboardingSubmissionMock.mockReturnValue({ mutateAsync: approveMock, isPending: false });
    const user = await openDrawer();

    await user.click(screen.getByTestId("onboarding-accept"));
    await user.click(await screen.findByTestId("onboarding-accept-record-payment"));
    await user.click(screen.getByTestId("onboarding-accept-confirm"));

    expect(approveMock).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ recordPayment: false }) }));
  });

  // Accepting enrols someone into a cohort; with several to choose from, guessing would put
  // a student in the wrong one, so the button stays disabled until a batch is picked.
  it("won't accept until a batch is chosen when the program has several", async () => {
    useOnboardingApprovableBatchesMock.mockReturnValue({
      data: [
        { id: "batch-1", name: "September 2026 Batch", startDate: null, status: "planned" },
        { id: "batch-2", name: "October 2026 Batch", startDate: null, status: "planned" },
      ],
      isLoading: false,
      isError: false,
    });
    const user = await openDrawer();

    await user.click(screen.getByTestId("onboarding-accept"));

    expect(await screen.findByTestId("onboarding-accept-confirm")).toBeDisabled();
  });

  it("explains there is nothing to invoice when the program is free", async () => {
    useOnboardingSubmissionMock.mockReturnValue({
      data: { ...SUBMISSION_DETAIL, programPricePaise: 0 },
      isLoading: false,
      isError: false,
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByText("Ananya Sharma"));
    await user.click(await screen.findByTestId("onboarding-accept"));

    expect(await screen.findByText("No invoice will be raised")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-accept-record-payment")).not.toBeInTheDocument();
  });

  // Rejecting emails the student, so it confirms, and says what the student will NOT see,
  // which is the thing a reviewer is most likely to assume wrongly.
  it("confirms a rejection, naming the recipient and excluding the internal notes", async () => {
    const rejectMock = vi.fn().mockResolvedValue(undefined);
    useRejectOnboardingSubmissionMock.mockReturnValue({ mutateAsync: rejectMock, isPending: false });
    const user = await openDrawer();

    await user.click(screen.getByTestId("onboarding-reject"));

    const dialog = await screen.findByTestId("confirm-reject-onboarding-submission");
    expect(dialog).toHaveTextContent("ananya@example.com");
    expect(dialog).toHaveTextContent(/internal notes are not included/i);

    await user.click(screen.getByRole("button", { name: "Reject & notify" }));
    expect(rejectMock).toHaveBeenCalledWith({ id: "sub-1", body: {} });
  });

  it("hides both decisions from a read-only role", async () => {
    useOnboardingSubmissionMock.mockReturnValue({ data: SUBMISSION_DETAIL, isLoading: false, isError: false });
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWorkspace({ ...BASE_ME, permissions: [{ key: "onboarding.view", scope: "all" }] });

    await user.click(screen.getByText("Ananya Sharma"));
    await screen.findByTestId("onboarding-submission-drawer");

    expect(screen.queryByTestId("onboarding-accept")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-reject")).not.toBeInTheDocument();
  });

  // An accepted submission has an enrolled student behind it; the API refuses to re-decide
  // it, so the buttons must not offer a click that can only fail.
  it("hides both decisions once the student is enrolled", async () => {
    useOnboardingSubmissionMock.mockReturnValue({
      data: { ...SUBMISSION_DETAIL, status: "approved" as const, studentProfileId: "student-1" },
      isLoading: false,
      isError: false,
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByText("Ananya Sharma"));
    await screen.findByTestId("onboarding-submission-drawer");

    expect(screen.queryByTestId("onboarding-accept")).not.toBeInTheDocument();
    expect(await screen.findByText("This student is already enrolled")).toBeInTheDocument();
  });
});

describe("OnboardingWorkspace, a11y", () => {
  it("has no detectable a11y violations with a populated list", async () => {
    const { container } = renderWorkspace();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
