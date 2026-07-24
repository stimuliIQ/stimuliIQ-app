import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContinueLearning } from "./continue-learning";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ContinueLearning — rendering", () => {
  it("renders the lesson title", () => {
    render(<ContinueLearning lessonTitle="Variables & types" />);
    expect(screen.getByTestId("continue-learning-title")).toHaveTextContent(
      "Variables & types",
    );
  });

  it("renders the program and module context when provided", () => {
    render(
      <ContinueLearning
        lessonTitle="NumPy arrays"
        moduleTitle="Module 3"
        programTitle="Python for Data Science"
      />,
    );
    const context = screen.getByTestId("continue-learning-context");
    expect(context).toHaveTextContent("Python for Data Science");
    expect(context).toHaveTextContent("Module 3");
  });

  it("renders only the programTitle when moduleTitle is omitted", () => {
    render(
      <ContinueLearning
        lessonTitle="NumPy arrays"
        programTitle="Python for Data Science"
      />,
    );
    expect(screen.getByTestId("continue-learning-context")).toHaveTextContent(
      "Python for Data Science",
    );
  });

  it("does not render the context line when neither program nor module is provided", () => {
    render(<ContinueLearning lessonTitle="Lesson" />);
    expect(screen.queryByTestId("continue-learning-context")).not.toBeInTheDocument();
  });

  it("renders a ProgressBar when progress is provided", () => {
    render(<ContinueLearning lessonTitle="Lesson" progress={60} />);
    expect(screen.getByTestId("progress-bar")).toHaveAttribute("aria-valuenow", "60");
  });

  it("does not render a ProgressBar when progress is omitted", () => {
    render(<ContinueLearning lessonTitle="Lesson" />);
    expect(screen.queryByTestId("progress-bar")).not.toBeInTheDocument();
  });

  it("renders the formatted last-position when lastPositionS is provided", () => {
    render(<ContinueLearning lessonTitle="Lesson" lastPositionS={420} />);
    // 420 seconds = 7:00
    expect(screen.getByText("7:00")).toBeInTheDocument();
  });

  it("renders the CTA button", () => {
    render(<ContinueLearning lessonTitle="Lesson" onResume={vi.fn()} />);
    expect(screen.getByTestId("continue-learning-cta")).toBeInTheDocument();
  });

  it("uses default data-testid='continue-learning'", () => {
    render(<ContinueLearning lessonTitle="Lesson" />);
    expect(screen.getByTestId("continue-learning")).toBeInTheDocument();
  });

  it("respects a custom data-testid", () => {
    render(<ContinueLearning lessonTitle="Lesson" data-testid="my-cl" />);
    expect(screen.getByTestId("my-cl")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CTA — onResume callback
// ---------------------------------------------------------------------------

describe("ContinueLearning — onResume callback", () => {
  it("renders the CTA as a <button> when onResume is provided (no href)", () => {
    render(<ContinueLearning lessonTitle="Lesson" onResume={vi.fn()} />);
    const cta = screen.getByTestId("continue-learning-cta");
    expect(cta.tagName).toBe("BUTTON");
  });

  it("fires onResume when the CTA button is clicked", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(<ContinueLearning lessonTitle="Lesson" onResume={onResume} />);

    await user.click(screen.getByTestId("continue-learning-cta"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CTA — resumeHref link
// ---------------------------------------------------------------------------

describe("ContinueLearning — resumeHref link", () => {
  it("renders the CTA as an anchor when resumeHref is provided", () => {
    render(
      <ContinueLearning
        lessonTitle="NumPy arrays"
        resumeHref="/lessons/les-012?t=180"
      />,
    );
    const cta = screen.getByTestId("continue-learning-cta");
    expect(cta.tagName).toBe("A");
    expect(cta).toHaveAttribute("href", "/lessons/les-012?t=180");
  });

  it("anchor has a descriptive aria-label including the lesson title", () => {
    render(
      <ContinueLearning
        lessonTitle="NumPy arrays"
        lastPositionS={180}
        resumeHref="/lessons/les-012?t=180"
      />,
    );
    const cta = screen.getByTestId("continue-learning-cta");
    // aria-label should mention the lesson title
    expect(cta.getAttribute("aria-label")).toContain("NumPy arrays");
  });
});

// ---------------------------------------------------------------------------
// a11y — aria attributes on the CTA
// ---------------------------------------------------------------------------

describe("ContinueLearning — a11y", () => {
  it("CTA has a non-empty aria-label", () => {
    render(<ContinueLearning lessonTitle="Variables & types" onResume={vi.fn()} />);
    const cta = screen.getByTestId("continue-learning-cta");
    const label = cta.getAttribute("aria-label") ?? "";
    expect(label.length).toBeGreaterThan(0);
  });

  it("CTA aria-label includes the lesson title when no lastPositionS", () => {
    render(<ContinueLearning lessonTitle="Variables & types" onResume={vi.fn()} />);
    const cta = screen.getByTestId("continue-learning-cta");
    expect(cta.getAttribute("aria-label")).toContain("Variables & types");
  });

  it("CTA aria-label includes the formatted position when lastPositionS is provided", () => {
    render(
      <ContinueLearning
        lessonTitle="Control flow"
        lastPositionS={300}
        onResume={vi.fn()}
      />,
    );
    // 300s = 5:00
    const cta = screen.getByTestId("continue-learning-cta");
    expect(cta.getAttribute("aria-label")).toContain("5:00");
  });
});
