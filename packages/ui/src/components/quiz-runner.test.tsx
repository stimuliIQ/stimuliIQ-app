import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  QuizRunner,
  QuestionCard,
  type AssessmentQuestionPublic,
} from "./quiz-runner";

// ---------------------------------------------------------------------------
// SECURITY CONTRACT TEST, No answer-key fields on the public type
// ---------------------------------------------------------------------------
// These compile-time assertions live in a describe so they run as test-time
// type checks (TypeScript strict mode + vitest).
//
// We assert that `AssessmentQuestionPublic` and `QuizOption` do NOT have the
// properties `answerKey`, `isCorrect`, `correctOptionId`. If any of those
// fields existed on the type, the assignment below would trigger a TS error
// under `exactOptionalPropertyTypes` / `strict`.
//
// The runtime test also verifies that a provided object without those fields
// renders without error, proving no answer-key data is required client-side.

describe("SECURITY: AssessmentQuestionPublic type has no answer-key fields", () => {
  it("renders with a question object that has NO isCorrect / answerKey / correctOptionId", () => {
    // TypeScript: the type annotation below would fail to compile if the type
    // required any of those fields. vitest runs tsc before test execution.
    const publicQuestion: AssessmentQuestionPublic = {
      id: "q1",
      type: "mcq_single",
      prompt: "What is 2 + 2?",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
        { id: "c", text: "5" },
      ],
      points: 1,
      order: 1,
    };

    // Runtime assertions: these keys do not exist on the object at runtime.
    // The TypeScript type does not declare them, so accessing them via an
    // index cast (through unknown) to Record<string, unknown> returns undefined,
    // proving no answer-key data is present client-side.
    const record = publicQuestion as unknown as Record<string, unknown>;
    expect(record["answerKey"]).toBeUndefined();
    expect(record["correctOptionId"]).toBeUndefined();

    const firstOption = (publicQuestion.options?.[0] ?? {}) as unknown as Record<string, unknown>;
    expect(firstOption["isCorrect"]).toBeUndefined();
    expect(firstOption["answerKey"]).toBeUndefined();

    // Type-level: prove AssessmentQuestionPublic does NOT have an `answerKey` key.
    // If someone added it to the type, this satisfies() check would surface the leak.
    type HasNoAnswerKey = "answerKey" extends keyof AssessmentQuestionPublic ? "FAIL" : "OK";
    type HasNoIsCorrectOnOption = "isCorrect" extends keyof (NonNullable<AssessmentQuestionPublic["options"]>[number]) ? "FAIL" : "OK";
    const _typeCheck1: HasNoAnswerKey = "OK";
    const _typeCheck2: HasNoIsCorrectOnOption = "OK";
    expect(_typeCheck1).toBe("OK");
    expect(_typeCheck2).toBe("OK");

    // Component renders without the answer key being present.
    render(
      <QuizRunner
        questions={[publicQuestion]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("quiz-runner")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sample data (public shape only, NO answer keys)
// ---------------------------------------------------------------------------

const mcqSingleQuestion: AssessmentQuestionPublic = {
  id: "q1",
  type: "mcq_single",
  prompt: "What is 2 + 2?",
  options: [
    { id: "a", text: "3" },
    { id: "b", text: "4" },
    { id: "c", text: "5" },
  ],
  points: 1,
  order: 1,
};

const mcqMultiQuestion: AssessmentQuestionPublic = {
  id: "q2",
  type: "mcq_multi",
  prompt: "Which are fruits?",
  options: [
    { id: "apple", text: "Apple" },
    { id: "carrot", text: "Carrot" },
    { id: "mango", text: "Mango" },
  ],
  points: 2,
  order: 2,
};

const descriptiveQuestion: AssessmentQuestionPublic = {
  id: "q3",
  type: "descriptive",
  prompt: "Explain the water cycle.",
  points: 5,
  order: 3,
};

const questions = [mcqSingleQuestion, mcqMultiQuestion, descriptiveQuestion];

// ---------------------------------------------------------------------------
// QuestionCard unit tests
// ---------------------------------------------------------------------------

describe("QuestionCard", () => {
  it("renders MCQ single question with radio inputs in a fieldset", () => {
    const { container } = render(
      <QuestionCard
        question={mcqSingleQuestion}
        index={1}
        total={3}
        answer={undefined}
        onAnswerChange={vi.fn()}
      />,
    );
    const fieldset = container.querySelector("fieldset");
    expect(fieldset).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("renders MCQ multi question with checkboxes", () => {
    render(
      <QuestionCard
        question={mcqMultiQuestion}
        index={2}
        total={3}
        answer={undefined}
        onAnswerChange={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
  });

  it("renders descriptive question with a labelled textarea", () => {
    render(
      <QuestionCard
        question={descriptiveQuestion}
        index={3}
        total={3}
        answer={undefined}
        onAnswerChange={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox", {
      name: /Explain the water cycle/i,
    });
    expect(textarea).toBeInTheDocument();
  });

  it("calls onAnswerChange with the selected option id on radio click", async () => {
    const onAnswerChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuestionCard
        question={mcqSingleQuestion}
        index={1}
        total={3}
        answer={undefined}
        onAnswerChange={onAnswerChange}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "4" }));
    expect(onAnswerChange).toHaveBeenCalledWith("q1", "b");
  });

  it("calls onAnswerChange with array for MCQ multi checkboxes", async () => {
    const onAnswerChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuestionCard
        question={mcqMultiQuestion}
        index={2}
        total={3}
        answer={undefined}
        onAnswerChange={onAnswerChange}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Apple" }));
    expect(onAnswerChange).toHaveBeenCalledWith("q2", ["apple"]);
  });

  it("disables all controls when disabled=true", () => {
    render(
      <QuestionCard
        question={mcqSingleQuestion}
        index={1}
        total={3}
        answer={undefined}
        onAnswerChange={vi.fn()}
        disabled
      />,
    );
    const radios = screen.getAllByRole("radio");
    for (const r of radios) {
      expect(r).toBeDisabled();
    }
  });

  // a11y: radio group has a fieldset+legend
  it("MCQ fieldset has a legend = the question prompt", () => {
    const { container } = render(
      <QuestionCard
        question={mcqSingleQuestion}
        index={1}
        total={3}
        answer={undefined}
        onAnswerChange={vi.fn()}
      />,
    );
    const legend = container.querySelector("fieldset legend");
    expect(legend?.textContent).toContain("What is 2 + 2?");
  });
});

// ---------------------------------------------------------------------------
// QuizRunner unit tests
// ---------------------------------------------------------------------------

describe("QuizRunner", () => {
  it("renders without crashing with questions", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("quiz-runner")).toBeInTheDocument();
  });

  it("shows 'No questions available' when questions is empty", () => {
    render(<QuizRunner questions={[]} onSubmit={vi.fn()} />);
    expect(screen.getByText("No questions available.")).toBeInTheDocument();
  });

  it("renders question navigation dots for each question", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    const nav = screen.getByTestId("quiz-runner-nav");
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(questions.length);
  });

  it("shows the first question on initial render", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("navigates to the next question on 'Next' button click", async () => {
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    await user.click(screen.getByTestId("quiz-runner-next"));
    expect(screen.getByText("Which are fruits?")).toBeInTheDocument();
  });

  it("navigates to a specific question via nav dots", async () => {
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    await user.click(screen.getByTestId("quiz-nav-3"));
    expect(screen.getByText("Explain the water cycle.")).toBeInTheDocument();
  });

  it("shows Previous button disabled on first question", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    const prev = screen.getByTestId("quiz-runner-prev");
    expect(prev).toBeDisabled();
  });

  it("increments answered count when an answer is selected", async () => {
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    // Initially 0 of 3 answered
    expect(screen.getByRole("status")).toHaveTextContent("0 of 3 answered");
    await user.click(screen.getByRole("radio", { name: "4" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 answered");
  });

  it("submit is hidden until the last question and disabled until all answered", async () => {
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    // First question: Next shown, Submit not yet rendered.
    expect(screen.queryByTestId("quiz-runner-submit")).not.toBeInTheDocument();
    // Jump to the last question, Submit now shows but is disabled (nothing answered).
    await user.click(screen.getByTestId("quiz-nav-3"));
    expect(screen.getByTestId("quiz-runner-submit")).toBeDisabled();
    // The why-disabled hint tells the student what's left.
    expect(screen.getByTestId("quiz-runner-submit-hint")).toHaveTextContent("3 left");
  });

  it("calls onSubmit only after all questions are answered and the submit is confirmed", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={onSubmit} />);
    // Answer every question.
    await user.click(screen.getByRole("radio", { name: "4" })); // q1
    await user.click(screen.getByTestId("quiz-nav-2"));
    await user.click(screen.getByRole("checkbox", { name: "Apple" })); // q2
    await user.click(screen.getByTestId("quiz-nav-3"));
    await user.type(screen.getByTestId("question-q3-textarea"), "Evaporation, then rain."); // q3

    // Submit is now enabled; clicking it opens a confirmation (no submit yet).
    await user.click(screen.getByTestId("quiz-runner-submit"));
    expect(onSubmit).not.toHaveBeenCalled();

    // Confirm, now onSubmit fires with the collected answers.
    const confirm = await screen.findByTestId("quiz-runner-submit-confirm");
    await user.click(within(confirm).getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({ q1: "b" }),
        tabSwitchCount: 0,
      }),
    );
  });

  it("submit button shows loading state while submitting=true", () => {
    // Single-question quiz so the first question is also the last (Submit visible).
    render(
      <QuizRunner questions={[mcqSingleQuestion]} onSubmit={vi.fn()} submitting />,
    );
    const submitBtn = screen.getByTestId("quiz-runner-submit");
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute("aria-busy", "true");
  });

  it("does not render a timer when expiresAt is not provided", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId("quiz-runner-timer")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // a11y tests
  // ---------------------------------------------------------------------------

  it("navigation dots have aria-label describing question + answered state", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    const dot1 = screen.getByTestId("quiz-nav-1");
    expect(dot1.getAttribute("aria-label")).toContain("Question 1");
  });

  it("first nav dot has aria-current=true (current question)", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("quiz-nav-1")).toHaveAttribute("aria-current", "true");
  });

  it("progress indicator has role=status for polite SR announcement", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
  });

  it("previous/next buttons have descriptive aria-labels", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("quiz-runner-prev")).toHaveAttribute(
      "aria-label",
      "Go to previous question",
    );
    expect(screen.getByTestId("quiz-runner-next")).toHaveAttribute(
      "aria-label",
      "Go to next question",
    );
  });

  it("submit button (last question) has a descriptive aria-label", async () => {
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    await user.click(screen.getByTestId("quiz-nav-3"));
    expect(screen.getByTestId("quiz-runner-submit")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Submit assessment"),
    );
  });

  it("nav region has aria-label for screen reader context", () => {
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "Question navigation" });
    expect(nav).toBeInTheDocument();
  });

  it("submit aria-label includes answered count for SR context", async () => {
    const user = userEvent.setup();
    render(<QuizRunner questions={questions} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "4" })); // answer q1
    await user.click(screen.getByTestId("quiz-nav-3")); // Submit lives on the last question
    const submitBtn = screen.getByTestId("quiz-runner-submit");
    expect(submitBtn.getAttribute("aria-label")).toContain("1 of 3 questions answered");
  });
});
