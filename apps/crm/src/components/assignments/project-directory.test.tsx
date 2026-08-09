// Tests for the Projects screen's authoring entry point.
//
// The screen was review-only: it listed projects and told an empty tenant to go create
// project-type assignments somewhere else. These cover the two things that make it an
// authoring screen — the button exists and is permission-gated, and what it opens can only
// ever produce a project (an assignment created from here would never appear here).

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";
import { ToastProvider } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { ProjectDirectory } from "./project-directory";

// Radix's Select is driven by pointer events jsdom does not implement, so the status filter
// can't be operated through the real component. Swap ONLY Select/SelectItem for native
// equivalents (same pattern as batch-form-drawer.test.tsx); DataTable, Drawer, StatusChip
// and the rest stay real, so what's under test is still the actual panel.
vi.mock("@repo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/ui")>();
  return {
    ...actual,
    Select: ({
      value,
      onValueChange,
      children,
      "aria-label": ariaLabel,
      "data-testid": testId,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      "aria-label"?: string;
      "data-testid"?: string;
    }) => (
      <select
        aria-label={ariaLabel}
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {children}
      </select>
    ),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

/**
 * Captures which submission the grader was opened on — the assertion that distinguishes
 * "graded the student I clicked" from the old behaviour, which opened whichever submission
 * happened to be the batch's most recent for that milestone.
 */
const gradeSpy = vi.hoisted(() => ({ submissionId: null as string | null }));

vi.mock("./grade-submission-drawer", () => ({
  GradeSubmissionDrawer: ({ submissionId }: { submissionId: string | null }) => {
    gradeSpy.submissionId = submissionId;
    return null;
  },
}));

const useAssignmentsListMock = vi.fn();
const useAssignmentMock = vi.fn();
const useSubmissionsListMock = vi.fn();

vi.mock("../../hooks/use-assignments", () => ({
  useAssignmentsList: (...args: unknown[]) => useAssignmentsListMock(...args),
  useAssignment: (...args: unknown[]) => useAssignmentMock(...args),
  useSubmissionsList: (...args: unknown[]) => useSubmissionsListMock(...args),
  // Reached via GradeSubmissionDrawer, which renders for anyone holding projects.review.
  useSubmissionDetail: () => ({ data: undefined, isLoading: false, isError: false }),
  useGradeSubmission: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The create drawer reads these; the cascade itself is covered in
// assignment-form-drawer.test.tsx, so here they only need to resolve.
vi.mock("../../hooks/use-batches", () => ({
  useBatchesList: () => ({
    data: {
      items: [
        { id: "batch-sep", name: "September Batch" },
        { id: "batch-oct", name: "October Batch" },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../../hooks/use-courses", () => ({
  useProgramsList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
  useCurriculum: () => ({ data: undefined, isLoading: false, isError: false }),
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

const AUTHOR_ME: MeResponse = {
  ...BASE_ME,
  permissions: [
    { key: "assignments.view", scope: "all" },
    { key: "assignments.create", scope: "all" },
    { key: "assignments.edit", scope: "all" },
    { key: "submissions.view", scope: "all" },
  ],
};

/** content_editor: authors projects, but is never granted sight of student work. */
const CONTENT_EDITOR_ME: MeResponse = {
  ...BASE_ME,
  roles: ["content_editor"],
  permissions: [
    { key: "assignments.view", scope: "all" },
    { key: "assignments.create", scope: "all" },
    { key: "assignments.edit", scope: "all" },
  ],
};

/** branch_manager: branch-wide oversight of submissions, but no grading. */
const BRANCH_MANAGER_ME: MeResponse = {
  ...BASE_ME,
  roles: ["branch_manager"],
  permissions: [
    { key: "assignments.view", scope: "branch" },
    { key: "submissions.view", scope: "branch" },
  ],
};

/** A reviewer: grades milestones, but doesn't author the pipeline. */
const REVIEWER_ME: MeResponse = {
  ...BASE_ME,
  roles: ["faculty"],
  permissions: [
    { key: "assignments.view", scope: "assigned" },
    { key: "submissions.view", scope: "assigned" },
    { key: "projects.review", scope: "assigned" },
  ],
};

function renderDirectory(me: MeResponse = AUTHOR_ME) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProjectDirectory me={me} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const PROJECT_ROW = {
  id: "assignment-1",
  title: "Parkinson's case study",
  lessonTitle: "Parkinson's Disease Case Review",
  kind: "project" as const,
  milestoneCount: 2,
  maxScore: 100,
  dueAt: null,
  isFinal: false,
  submissionCount: 3,
  gradedCount: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const PROJECT_DETAIL = {
  assignment: {
    id: "assignment-1",
    lessonId: "lesson-1",
    lessonTitle: "Parkinson's Disease Case Review",
    kind: "project" as const,
    title: "Parkinson's case study",
    programId: "program-1",
    programTitle: "Clinical Neurology",
    instructions: "Present the differential diagnosis.",
    maxScore: 100,
    dueAt: null,
    allowResubmit: true,
    isFinal: false,
    milestones: [
      { id: "m-1", assignmentId: "assignment-1", title: "History taking", order: 0, dueAt: null, createdAt: "2026-08-01T00:00:00.000Z" },
    ],
    submissionCount: 3,
    gradedCount: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  milestoneStates: [],
  overallStatus: "under_review" as const,
};

/** Two students, so a per-student view is distinguishable from a per-milestone rollup. */
const SUBMISSIONS = [
  {
    id: "sub-1",
    assignmentId: "assignment-1",
    assignmentTitle: "Parkinson's case study",
    milestoneId: "m-1",
    milestoneTitle: "History taking",
    enrollmentId: "enrol-1",
    studentId: "student-1",
    studentName: "Ananya Sharma",
    batchId: "batch-sep",
    batchName: "September Batch",
    status: "submitted" as const,
    attemptNo: 1,
    score: null,
    maxScore: 100,
    submittedAt: "2026-08-05T00:00:00.000Z",
    gradedAt: null,
  },
  {
    id: "sub-2",
    assignmentId: "assignment-1",
    assignmentTitle: "Parkinson's case study",
    milestoneId: "m-1",
    milestoneTitle: "History taking",
    enrollmentId: "enrol-2",
    studentId: "student-2",
    studentName: "Ravi Kumar",
    batchId: "batch-oct",
    batchName: "October Batch",
    status: "graded" as const,
    attemptNo: 2,
    score: 82,
    maxScore: 100,
    submittedAt: "2026-08-06T00:00:00.000Z",
    gradedAt: "2026-08-07T00:00:00.000Z",
  },
];

function submissionsResult(items = SUBMISSIONS) {
  return {
    data: { items, meta: { page: 1, pageSize: 10, total: items.length, hasMore: false } },
    isLoading: false,
    isError: false,
  };
}

/** Renders with one project in the list, so the row can be clicked. */
function renderWithProject(me: MeResponse = AUTHOR_ME) {
  useAssignmentsListMock.mockReturnValue({
    data: { items: [PROJECT_ROW], meta: { page: 1, pageSize: 20, total: 1, hasMore: false } },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  return renderDirectory(me);
}

beforeEach(() => {
  useAssignmentsListMock.mockReturnValue({
    data: { items: [], meta: { page: 1, pageSize: 20, total: 0, hasMore: false } },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  useAssignmentMock.mockReturnValue({ data: PROJECT_DETAIL.assignment, isLoading: false, isError: false });
  useSubmissionsListMock.mockReturnValue(submissionsResult());
  gradeSpy.submissionId = null;
});

describe("ProjectDirectory — authoring", () => {
  it("offers Add project to someone who can create assignments", () => {
    renderDirectory();
    expect(screen.getByTestId("projects-create-button")).toBeInTheDocument();
  });

  // A project IS an assignment of kind=project, so authoring rides on the same permission
  // the server enforces — a reviewer must not get an authoring affordance.
  it("hides it from a review-only role", () => {
    renderDirectory(REVIEWER_ME);
    expect(screen.queryByTestId("projects-create-button")).not.toBeInTheDocument();
  });

  it("opens a project-only create form", async () => {
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByTestId("projects-create-button"));

    expect(await screen.findByTestId("assignment-create-drawer")).toBeInTheDocument();
    // Locked to project: no kind picker, and the submit button says so.
    expect(screen.queryByTestId("assignment-form-kind")).not.toBeInTheDocument();
    expect(screen.getByTestId("assignment-form-submit")).toHaveTextContent("Create project");
  });

  it("points an empty tenant at the button rather than another screen", () => {
    renderDirectory();
    expect(screen.getByText(/Add a project, pick the course and lesson/)).toBeInTheDocument();
  });

  it("tells a reviewer why the list is empty without offering an action they lack", () => {
    renderDirectory(REVIEWER_ME);
    expect(screen.getByText(/once someone with authoring access adds one/)).toBeInTheDocument();
  });
});

// Detail opens in a side panel over the still-visible list, not an inline block below the
// table — the row you clicked stays put and the review sits at a fixed position.
describe("ProjectDirectory — detail panel", () => {
  it("opens the panel when the row is clicked", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));

    const drawer = await screen.findByTestId("project-detail-drawer");
    expect(drawer).toBeInTheDocument();
    // Titled from the clicked row, so the header is right before the detail request lands.
    expect(drawer).toHaveTextContent("Parkinson's case study");
  });

  it("shows what the table can't: instructions, resubmission policy and the milestone list", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    const drawer = await screen.findByTestId("project-detail-drawer");

    expect(drawer).toHaveTextContent("Present the differential diagnosis.");
    expect(drawer).toHaveTextContent("Allowed after grading");
    expect(within(drawer).getByTestId("project-milestones")).toHaveTextContent("History taking");
  });

  it("closes on Close", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    await user.click(await screen.findByTestId("project-detail-close"));

    await waitFor(() => expect(screen.queryByTestId("project-detail-drawer")).not.toBeInTheDocument());
  });

  // A project with no milestones is a legitimate shape (graded as one submission), so it
  // must read as a fact rather than an error.
  it("explains a project that has no milestones instead of showing an empty list", async () => {
    useAssignmentMock.mockReturnValue({
      data: { ...PROJECT_DETAIL.assignment, milestones: [] },
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));

    expect(await screen.findByText("No milestones defined")).toBeInTheDocument();
    expect(screen.queryByTestId("project-milestones")).not.toBeInTheDocument();
  });

  it("surfaces a failed detail load inside the panel", async () => {
    useAssignmentMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));

    expect(await screen.findByTestId("project-detail-error")).toBeInTheDocument();
  });

  // The correction this panel exists for: faculty verifying a cohort need "who submitted
  // what". The old milestone rollup showed one row per milestone carrying the batch's most
  // recent submission and no student name at all.
  it("lists submissions per STUDENT, with the milestone each one is against", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    const table = await screen.findByTestId("project-submissions-table");

    expect(within(table).getByText("Ananya Sharma")).toBeInTheDocument();
    expect(within(table).getByText("Ravi Kumar")).toBeInTheDocument();
    // Both students submitted the SAME milestone — a per-milestone view could only ever
    // have shown one of them.
    expect(within(table).getAllByText("History taking")).toHaveLength(2);
    expect(within(table).getByText("Awaiting review")).toBeInTheDocument();
    expect(within(table).getByText("82/100")).toBeInTheDocument();
  });

  it("opens the grader on the student row that was clicked", async () => {
    const user = userEvent.setup();
    // Faculty holding `projects.review` — the actor who actually grades.
    renderWithProject(REVIEWER_ME);

    await user.click(screen.getByText("Parkinson's case study"));
    await user.click(await within(await screen.findByTestId("project-submissions-table")).findByText("Ravi Kumar"));

    // sub-2 is Ravi's — the point being it is HIS submission, not whoever submitted last.
    expect(gradeSpy.submissionId).toBe("sub-2");
  });

  it("filters the queue down to what still needs review", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    await screen.findByTestId("project-submissions-filter");

    // The hook is called with the chosen status — the server does the filtering.
    useSubmissionsListMock.mockClear();
    await user.selectOptions(screen.getByTestId("project-submissions-filter"), "submitted");

    expect(useSubmissionsListMock).toHaveBeenLastCalledWith(
      "assignment-1",
      expect.objectContaining({ status: "submitted" }),
    );
  });

  // Reviewers work one cohort at a time — "who in the September batch still owes me this?"
  it("shows which batch each submission came from", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    const table = await screen.findByTestId("project-submissions-table");

    expect(within(table).getByText("September Batch")).toBeInTheDocument();
    expect(within(table).getByText("October Batch")).toBeInTheDocument();
  });

  it("narrows the queue to one cohort, server-side", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    await screen.findByTestId("project-submissions-batch-filter");

    useSubmissionsListMock.mockClear();
    await user.selectOptions(screen.getByTestId("project-submissions-batch-filter"), "batch-sep");

    expect(useSubmissionsListMock).toHaveBeenLastCalledWith(
      "assignment-1",
      expect.objectContaining({ batchId: "batch-sep" }),
    );
  });

  it("drops the Batch column once a single cohort is selected", async () => {
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));
    await user.selectOptions(await screen.findByTestId("project-submissions-batch-filter"), "batch-sep");

    // A column repeating the active filter is noise.
    const table = await screen.findByTestId("project-submissions-table");
    expect(within(table).queryByRole("columnheader", { name: "Batch" })).not.toBeInTheDocument();
  });

  it("says nothing has been handed in yet, rather than showing an empty grid", async () => {
    useSubmissionsListMock.mockReturnValue(submissionsResult([]));
    const user = userEvent.setup();
    renderWithProject();

    await user.click(screen.getByText("Parkinson's case study"));

    expect(await screen.findByText("No submissions yet")).toBeInTheDocument();
  });

  // branch_manager oversees submissions across their branch but is not granted
  // projects.review — they must be able to READ the queue without a grading affordance.
  it("lets an oversight role read the queue without opening the grader", async () => {
    const user = userEvent.setup();
    renderWithProject(BRANCH_MANAGER_ME);

    await user.click(screen.getByText("Parkinson's case study"));
    const table = await screen.findByTestId("project-submissions-table");
    expect(within(table).getByText("Ananya Sharma")).toBeInTheDocument();

    await user.click(within(table).getByText("Ananya Sharma"));
    expect(gradeSpy.submissionId).toBeNull();
  });

  // The regression this endpoint split exists to prevent: the panel used to read
  // `.../project` (projects.review), which 403s for both roles below — so clicking a row
  // showed nothing but "Couldn't load project detail".
  it("still shows the project itself to a role without projects.review", async () => {
    const user = userEvent.setup();
    renderWithProject(BRANCH_MANAGER_ME);

    await user.click(screen.getByText("Parkinson's case study"));
    const drawer = await screen.findByTestId("project-detail-drawer");

    expect(drawer).toHaveTextContent("Present the differential diagnosis.");
    expect(within(drawer).getByTestId("project-milestones")).toBeInTheDocument();
    expect(screen.queryByTestId("project-detail-error")).not.toBeInTheDocument();
  });

  it("tells an author without submissions access why the queue is missing", async () => {
    const user = userEvent.setup();
    renderWithProject(CONTENT_EDITOR_ME);

    await user.click(screen.getByText("Parkinson's case study"));

    expect(await screen.findByText("You don't have access to student submissions")).toBeInTheDocument();
    // Not an empty table, which would read as "nobody has submitted".
    expect(screen.queryByTestId("project-submissions-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-submissions-filter")).not.toBeInTheDocument();
  });

  it("offers Delete in the panel only to someone who can delete", async () => {
    const user = userEvent.setup();
    renderWithProject(REVIEWER_ME);

    await user.click(screen.getByText("Parkinson's case study"));
    await screen.findByTestId("project-detail-drawer");

    expect(screen.queryByTestId("project-detail-delete")).not.toBeInTheDocument();
  });
});

describe("ProjectDirectory — a11y", () => {
  it("has no detectable violations", async () => {
    const { container } = renderDirectory();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
