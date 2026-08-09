// Tests for the review drawer's two decisions — grade, and send back for changes.
//
// Send back is the half that never existed: `SubmissionStatus.returned` shipped in Phase 4
// and nothing in the API ever wrote it, so work needing another attempt had to be graded low
// (permanent) or left pending forever. These pin the parts that make the loop safe:
// a reason is mandatory (it is the student's entire instruction set), and the action is only
// offered on work that is actually awaiting review — the API refuses the rest.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

import { GradeSubmissionDrawer } from "./grade-submission-drawer";

const returnMock = vi.fn();
const gradeMock = vi.fn();
const useSubmissionDetailMock = vi.fn();

vi.mock("../../hooks/use-assignments", () => ({
  useSubmissionDetail: (...args: unknown[]) => useSubmissionDetailMock(...args),
  useGradeSubmission: () => ({ mutateAsync: gradeMock, isPending: false }),
  useReturnSubmission: () => ({ mutateAsync: returnMock, isPending: false }),
}));

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    assignmentId: "assignment-1",
    assignmentTitle: "Parkinson's case study",
    milestoneId: null,
    milestoneTitle: null,
    enrollmentId: "enrol-1",
    studentId: "student-1",
    studentName: "Ananya Sharma",
    status: "submitted",
    attemptNo: 1,
    files: [],
    fileDownloadUrls: [],
    text: "My case write-up.",
    link: null,
    score: null,
    maxScore: 100,
    rubric: null,
    feedback: null,
    gradedAt: null,
    gradedByName: null,
    submittedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <GradeSubmissionDrawer submissionId="sub-1" assignmentId="assignment-1" onOpenChange={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  returnMock.mockReset().mockResolvedValue({});
  gradeMock.mockReset().mockResolvedValue({});
  useSubmissionDetailMock.mockReturnValue({
    data: submission(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe("GradeSubmissionDrawer — send back for changes", () => {
  it("offers Send back alongside grading on work awaiting review", () => {
    renderDrawer();
    expect(screen.getByTestId("return-submission-open")).toBeInTheDocument();
    expect(screen.getByTestId("grade-submission-submit")).toBeInTheDocument();
  });

  // The reason is the student's entire instruction set — "no" is not something they can act
  // on, and an empty one turns a review into a rejection with no route forward.
  it("won't send back without a usable reason", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("return-submission-open"));
    const confirm = await screen.findByTestId("return-submission-confirm");
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId("return-reason-input"), "too short");
    expect(screen.getByTestId("return-submission-confirm")).toBeDisabled();

    await user.type(screen.getByTestId("return-reason-input"), " — add the differential diagnosis.");
    expect(screen.getByTestId("return-submission-confirm")).toBeEnabled();
  });

  it("sends the reason and nothing else — returning is not grading", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("return-submission-open"));
    await user.type(
      await screen.findByTestId("return-reason-input"),
      "The differential diagnosis section is missing.",
    );
    await user.click(screen.getByTestId("return-submission-confirm"));

    await waitFor(() => expect(returnMock).toHaveBeenCalled());
    expect(returnMock).toHaveBeenCalledWith({
      id: "sub-1",
      reason: "The differential diagnosis section is missing.",
    });
    expect(gradeMock).not.toHaveBeenCalled();
  });

  it("hides the rubric while the reason is being written", async () => {
    const user = userEvent.setup();
    renderDrawer();

    expect(screen.getByTestId("grade-rubric-grader")).toBeInTheDocument();
    await user.click(screen.getByTestId("return-submission-open"));

    expect(await screen.findByTestId("return-submission-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("grade-rubric-grader")).not.toBeInTheDocument();
  });

  it("returns to grading on Back, without sending anything", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByTestId("return-submission-open"));
    await user.click(await screen.findByTestId("return-submission-cancel"));

    expect(await screen.findByTestId("grade-rubric-grader")).toBeInTheDocument();
    expect(returnMock).not.toHaveBeenCalled();
  });

  // The API refuses both of these, so offering the button could only ever produce a 422.
  it("does not offer Send back on already-graded work", () => {
    useSubmissionDetailMock.mockReturnValue({
      data: submission({ status: "graded", score: 80 }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderDrawer();
    expect(screen.queryByTestId("return-submission-open")).not.toBeInTheDocument();
  });

  it("does not offer Send back on work already sent back, and says why", () => {
    useSubmissionDetailMock.mockReturnValue({
      data: submission({ status: "returned", feedback: "Add the differential." }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderDrawer();

    expect(screen.queryByTestId("return-submission-open")).not.toBeInTheDocument();
    expect(screen.getByText("Sent back for changes")).toBeInTheDocument();
  });
});
