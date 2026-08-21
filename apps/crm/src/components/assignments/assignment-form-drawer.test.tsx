// Tests for the course → lesson cascade in the assignment/project authoring drawer.
//
// The property under test is the one that changed shape: `assignments.lesson_id` is a
// required FK, and this form used to ask for it as a raw uuid typed into a text box. Staff
// do not know lesson uuids, so the field is now two dependent dropdowns. What matters is
// that the cascade cannot emit an incoherent pair, a lesson from a course other than the
// one selected, and that a course with no lessons says so instead of rendering an empty,
// unexplained dropdown.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

import { AssignmentFormDrawer } from "./assignment-form-drawer";

// Radix's Select is driven by pointer events jsdom does not implement, and this form can't
// be submitted without the two pickers. Swap ONLY Select/SelectItem for native equivalents
// (the established pattern, see batch-form-drawer.test.tsx); every other @repo/ui
// component stays real, so the form under test is still the actual form.
vi.mock("@repo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/ui")>();
  return {
    ...actual,
    Select: ({
      label,
      value,
      onValueChange,
      children,
      disabled,
      placeholder,
      helperText,
      "data-testid": testId,
    }: {
      label?: string;
      value?: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      disabled?: boolean;
      placeholder?: string;
      helperText?: React.ReactNode;
      "data-testid"?: string;
    }) => (
      <label>
        {label}
        <select
          data-testid={testId}
          disabled={disabled}
          value={value ?? ""}
          onChange={(e) => onValueChange?.(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
        {helperText ? <span>{helperText}</span> : null}
      </label>
    ),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const createAssignmentMock = vi.fn();
const updateAssignmentMock = vi.fn();

vi.mock("../../hooks/use-assignments", () => ({
  useCreateAssignment: () => ({ mutateAsync: createAssignmentMock, isPending: false }),
  useUpdateAssignment: () => ({ mutateAsync: updateAssignmentMock, isPending: false }),
}));

const NEURO = { id: "11111111-1111-4111-8111-111111111111", title: "Clinical Neurology", status: "published" };
const CARDIO = { id: "22222222-2222-4222-8222-222222222222", title: "Cardiology", status: "draft" };

const NEURO_LESSON = "33333333-3333-4333-8333-333333333333";
const CARDIO_LESSON = "44444444-4444-4444-8444-444444444444";

/** Curriculum per course, so switching the course genuinely changes the lesson options. */
const CURRICULA: Record<string, { programId: string; modules: unknown[] }> = {
  [NEURO.id]: {
    programId: NEURO.id,
    modules: [
      // Deliberately out of order, and with a lesson title that repeats across modules,
      // the option label has to disambiguate them.
      { id: "m-2", title: "Week 2", order: 1, lessons: [{ id: "l-dup", title: "Intro", type: "video", order: 0, isPreview: false }] },
      {
        id: "m-1",
        title: "Week 1",
        order: 0,
        lessons: [
          { id: NEURO_LESSON, title: "Intro", type: "video", order: 0, isPreview: false },
          { id: "l-3", title: "Case review", type: "text", order: 1, isPreview: false },
        ],
      },
    ],
  },
  [CARDIO.id]: { programId: CARDIO.id, modules: [{ id: "m-9", title: "Basics", order: 0, lessons: [{ id: CARDIO_LESSON, title: "ECG", type: "video", order: 0, isPreview: false }] }] },
};

/** An id with no curriculum entry stands in for a course that has no lessons yet. */
const EMPTY_COURSE = { id: "55555555-5555-4555-8555-555555555555", title: "Brand new course", status: "draft" };

vi.mock("../../hooks/use-courses", () => ({
  useProgramsList: () => ({ data: { items: [NEURO, CARDIO, EMPTY_COURSE] }, isLoading: false, isError: false }),
  useCurriculum: (programId: string | undefined) => ({
    data: programId ? (CURRICULA[programId] ?? { programId, modules: [] }) : undefined,
    isLoading: false,
    isError: false,
  }),
}));

function renderDrawer(props: Partial<React.ComponentProps<typeof AssignmentFormDrawer>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AssignmentFormDrawer open onOpenChange={() => {}} lockedKind="project" {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Fills the two fields every submit needs beyond the cascade. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("assignment-form-title"), "Stroke case study");
}

beforeEach(() => {
  createAssignmentMock.mockReset().mockResolvedValue({});
  updateAssignmentMock.mockReset().mockResolvedValue({});
});

describe("AssignmentFormDrawer, course → lesson cascade", () => {
  it("asks for a course and a lesson, never a raw id", () => {
    renderDrawer();

    expect(screen.getByTestId("assignment-form-course")).toBeInTheDocument();
    expect(screen.getByTestId("assignment-form-lesson-id")).toBeInTheDocument();
    // The old free-text affordance is gone, a select has no placeholder attribute here.
    expect(screen.queryByPlaceholderText(/lesson_/)).not.toBeInTheDocument();
  });

  it("won't offer lessons until a course is chosen", () => {
    renderDrawer();

    expect(screen.getByTestId("assignment-form-lesson-id")).toBeDisabled();
    expect(screen.getByText("Choose a course first")).toBeInTheDocument();
  });

  it("lists the chosen course's lessons in teaching order, labelled by module", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assignment-form-course"), NEURO.id);

    const options = Array.from(
      screen.getByTestId("assignment-form-lesson-id").querySelectorAll("option"),
    ).map((o) => o.textContent);
    // Module order (Week 1 before Week 2) despite the source array being reversed, and the
    // repeated "Intro" title disambiguated by its module.
    expect(options).toEqual(["Choose a lesson", "Week 1 · Intro", "Week 1 · Case review", "Week 2 · Intro"]);
  });

  it("creates the project against the chosen lesson", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assignment-form-course"), NEURO.id);
    await user.selectOptions(screen.getByTestId("assignment-form-lesson-id"), NEURO_LESSON);
    await fillRequiredFields(user);
    await user.click(screen.getByTestId("assignment-form-submit"));

    await waitFor(() => expect(createAssignmentMock).toHaveBeenCalled());
    expect(createAssignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ lessonId: NEURO_LESSON, kind: "project", title: "Stroke case study" }),
    );
  });

  // The pair must stay coherent: keeping the old lesson would submit one course's lesson
  // under another course, which the dropdown no longer even shows.
  it("clears the chosen lesson when the course changes", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assignment-form-course"), NEURO.id);
    await user.selectOptions(screen.getByTestId("assignment-form-lesson-id"), NEURO_LESSON);
    expect(screen.getByTestId("assignment-form-lesson-id")).toHaveValue(NEURO_LESSON);

    await user.selectOptions(screen.getByTestId("assignment-form-course"), CARDIO.id);

    await waitFor(() => expect(screen.getByTestId("assignment-form-lesson-id")).toHaveValue(""));
  });

  it("says what to do when the course has no lessons yet", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assignment-form-course"), EMPTY_COURSE.id);

    expect(screen.getByText("This course has no lessons yet")).toBeInTheDocument();
    expect(screen.getByText(/Add a lesson to this course under Courses/)).toBeInTheDocument();
  });

  it("marks a course that isn't published, so a project isn't attached to a draft unknowingly", async () => {
    renderDrawer();

    const options = Array.from(
      screen.getByTestId("assignment-form-course").querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(options).toContain("Clinical Neurology");
    expect(options).toContain("Cardiology (draft)");
  });
});

describe("AssignmentFormDrawer, locked kind", () => {
  // A page that only lists projects must not be able to create a plain assignment: it would
  // be created successfully and then never appear.
  it("hides the kind picker and submits as a project", async () => {
    const user = userEvent.setup();
    renderDrawer({ lockedKind: "project" });

    expect(screen.queryByTestId("assignment-form-kind")).not.toBeInTheDocument();
    expect(screen.getByTestId("assignment-form-submit")).toHaveTextContent("Create project");

    await user.selectOptions(screen.getByTestId("assignment-form-course"), NEURO.id);
    await user.selectOptions(screen.getByTestId("assignment-form-lesson-id"), NEURO_LESSON);
    await fillRequiredFields(user);
    await user.click(screen.getByTestId("assignment-form-submit"));

    await waitFor(() => expect(createAssignmentMock).toHaveBeenCalled());
    expect(createAssignmentMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "project" }));
  });

  it("still offers the kind picker when nothing is locked", () => {
    renderDrawer({ lockedKind: undefined });
    expect(screen.getByTestId("assignment-form-kind")).toBeInTheDocument();
  });

  // Milestones are what make a project a project, the fieldset has to be reachable from
  // the Projects screen without first flipping a kind dropdown that isn't there.
  it("offers milestones straight away for a locked project", () => {
    renderDrawer();
    expect(screen.getByTestId("add-milestone-button")).toBeInTheDocument();
  });
});
