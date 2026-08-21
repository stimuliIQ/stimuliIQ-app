// Tests for the course → module cascade in the assessment authoring drawer.
//
// The property under test is the one that changed shape: `assessments.module_id` is a required
// FK, and this form used to ask for it as a raw uuid typed into a text box. Staff do not know
// module uuids, so the field is now two dependent dropdowns. What matters is that the cascade
// cannot emit an incoherent pair, a module from a course other than the one selected, and
// that a course with no modules says so instead of rendering an empty, unexplained dropdown.
//
// Mirrors assignment-form-drawer.test.tsx deliberately; the two cascades differ only in the
// depth they stop at (module here, lesson there).

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

import { AssessmentFormDrawer } from "./assessment-form-drawer";

// Radix's Select is driven by pointer events jsdom does not implement, and this form can't be
// submitted without the two pickers. Swap ONLY Select/SelectItem for native equivalents (the
// established pattern, see assignment-form-drawer.test.tsx); every other @repo/ui component
// stays real, so the form under test is still the actual form.
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

const createAssessmentMock = vi.fn();
const updateAssessmentMock = vi.fn();

vi.mock("../../hooks/use-assessments", () => ({
  useCreateAssessment: () => ({ mutateAsync: createAssessmentMock, isPending: false }),
  useUpdateAssessment: () => ({ mutateAsync: updateAssessmentMock, isPending: false }),
}));

const NEURO = { id: "11111111-1111-4111-8111-111111111111", title: "Clinical Neurology", status: "published" };
const CARDIO = { id: "22222222-2222-4222-8222-222222222222", title: "Cardiology", status: "draft" };

const NEURO_MODULE = "33333333-3333-4333-8333-333333333333";
const CARDIO_MODULE = "44444444-4444-4444-8444-444444444444";

/** Curriculum per course, so switching the course genuinely changes the module options. */
const CURRICULA: Record<string, { programId: string; modules: unknown[] }> = {
  [NEURO.id]: {
    programId: NEURO.id,
    // Deliberately out of order, the picker has to present teaching order, not fetch order.
    modules: [
      { id: "m-late", title: "Week 2, Stroke", order: 1, lessons: [] },
      { id: NEURO_MODULE, title: "Week 1, Foundations", order: 0, lessons: [] },
    ],
  },
  [CARDIO.id]: {
    programId: CARDIO.id,
    modules: [{ id: CARDIO_MODULE, title: "Basics", order: 0, lessons: [] }],
  },
};

/** An id with no curriculum entry stands in for a course that has no modules yet. */
const EMPTY_COURSE = { id: "55555555-5555-4555-8555-555555555555", title: "Brand new course", status: "draft" };

vi.mock("../../hooks/use-courses", () => ({
  useProgramsList: () => ({ data: { items: [NEURO, CARDIO, EMPTY_COURSE] }, isLoading: false, isError: false }),
  useCurriculum: (programId: string | undefined) => ({
    data: programId ? (CURRICULA[programId] ?? { programId, modules: [] }) : undefined,
    isLoading: false,
    isError: false,
  }),
}));

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AssessmentFormDrawer open onOpenChange={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * Fills everything a submit needs beyond the cascade. The default question ships with an empty
 * prompt and empty option texts, all of which zod rejects, so a submit test has to complete
 * them or it never reaches the mutation regardless of the cascade.
 */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("assessment-form-title"), "Week 1 knowledge check");
  await user.type(screen.getByTestId("question-0-prompt"), "Which cranial nerve controls eye abduction?");
  await user.type(screen.getByLabelText("Option opt-a text"), "CN VI");
  await user.type(screen.getByLabelText("Option opt-b text"), "CN III");
}

beforeEach(() => {
  createAssessmentMock.mockReset().mockResolvedValue({});
  updateAssessmentMock.mockReset().mockResolvedValue({});
});

describe("AssessmentFormDrawer, course → module cascade", () => {
  it("asks for a course and a module, never a raw id", () => {
    renderDrawer();
    expect(screen.getByTestId("assessment-form-course")).toBeInTheDocument();
    expect(screen.getByTestId("assessment-form-module-id")).toBeInTheDocument();
    // The old field was a free-text box; a <select> is the whole point of the change.
    expect(screen.getByTestId("assessment-form-module-id").tagName).toBe("SELECT");
    expect(screen.queryByPlaceholderText(/module_/i)).not.toBeInTheDocument();
  });

  it("won't offer modules until a course is chosen", () => {
    renderDrawer();
    expect(screen.getByTestId("assessment-form-module-id")).toBeDisabled();
    expect(screen.getByText("Choose a course first")).toBeInTheDocument();
  });

  it("lists the chosen course's modules in teaching order", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), NEURO.id);

    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).not.toBeDisabled());
    const options = Array.from(
      screen.getByTestId("assessment-form-module-id").querySelectorAll("option"),
    )
      .map((o) => o.textContent)
      .filter((t) => t && !t.startsWith("Choose"));
    expect(options).toEqual(["Week 1, Foundations", "Week 2, Stroke"]);
  });

  it("creates the assessment against the chosen module", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), NEURO.id);
    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).not.toBeDisabled());
    await user.selectOptions(screen.getByTestId("assessment-form-module-id"), NEURO_MODULE);
    await fillRequiredFields(user);

    await user.click(screen.getByTestId("assessment-form-submit"));

    await waitFor(() => expect(createAssessmentMock).toHaveBeenCalledTimes(1));
    expect(createAssessmentMock.mock.calls[0]![0]).toMatchObject({ moduleId: NEURO_MODULE });
  });

  it("clears the chosen module when the course changes", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), NEURO.id);
    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).not.toBeDisabled());
    await user.selectOptions(screen.getByTestId("assessment-form-module-id"), NEURO_MODULE);
    expect(screen.getByTestId("assessment-form-module-id")).toHaveValue(NEURO_MODULE);

    // Switching course must not leave the previous course's module selected, submitting that
    // pair is the cross-course mistake the raw-uuid field allowed silently.
    await user.selectOptions(screen.getByTestId("assessment-form-course"), CARDIO.id);
    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).toHaveValue(""));
  });

  it("says what to do when the course has no modules yet", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), EMPTY_COURSE.id);

    expect(await screen.findByText("This course has no modules yet")).toBeInTheDocument();
    expect(screen.getByText(/Add a module to this course/i)).toBeInTheDocument();
  });

  it("submits with only the two filled choices, blank C and D are dropped, not rejected", async () => {
    // REGRESSION. The form renders four choice rows but seeded ids for only two, so every
    // submit carried `{ text: "" }` entries with no `id`. zod rejected them at
    // `questions.0.options.2.id`, a path no field is bound to, so nothing rendered and the
    // drawer simply never submitted. Creating an MCQ assessment was impossible.
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), NEURO.id);
    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).not.toBeDisabled());
    await user.selectOptions(screen.getByTestId("assessment-form-module-id"), NEURO_MODULE);
    await fillRequiredFields(user);

    await user.click(screen.getByTestId("assessment-form-submit"));

    await waitFor(() => expect(createAssessmentMock).toHaveBeenCalledTimes(1));
    const payload = createAssessmentMock.mock.calls[0]![0] as {
      questions: { options: { id: string; text: string }[] }[];
    };
    expect(payload.questions[0]!.options).toEqual([
      { id: "opt-a", text: "CN VI" },
      { id: "opt-b", text: "CN III" },
    ]);
  });

  it("keeps a third choice when the author fills it", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), NEURO.id);
    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).not.toBeDisabled());
    await user.selectOptions(screen.getByTestId("assessment-form-module-id"), NEURO_MODULE);
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText("Option opt-c text"), "CN IV");

    await user.click(screen.getByTestId("assessment-form-submit"));

    await waitFor(() => expect(createAssessmentMock).toHaveBeenCalledTimes(1));
    const payload = createAssessmentMock.mock.calls[0]![0] as {
      questions: { options: { id: string; text: string }[] }[];
    };
    expect(payload.questions[0]!.options.map((o) => o.id)).toEqual(["opt-a", "opt-b", "opt-c"]);
  });

  it("submits untimed when the optional time limit is left blank", async () => {
    // REGRESSION. `timeLimitS` registered both `valueAsNumber` and `setValueAs`; RHF honours
    // the former, so an untouched field arrived as NaN and `z.number().nullable().optional()`
    // rejected it, the optional field failed precisely by being left alone.
    const user = userEvent.setup();
    renderDrawer();

    await user.selectOptions(screen.getByTestId("assessment-form-course"), NEURO.id);
    await waitFor(() => expect(screen.getByTestId("assessment-form-module-id")).not.toBeDisabled());
    await user.selectOptions(screen.getByTestId("assessment-form-module-id"), NEURO_MODULE);
    await fillRequiredFields(user);

    await user.click(screen.getByTestId("assessment-form-submit"));

    await waitFor(() => expect(createAssessmentMock).toHaveBeenCalledTimes(1));
    expect(createAssessmentMock.mock.calls[0]![0]).toMatchObject({ timeLimitS: null });
  });

  it("marks a course that isn't published, so an assessment isn't attached to a draft unknowingly", () => {
    renderDrawer();
    const courseOptions = Array.from(
      screen.getByTestId("assessment-form-course").querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(courseOptions).toContain("Clinical Neurology");
    expect(courseOptions).toContain("Cardiology (draft)");
  });
});
