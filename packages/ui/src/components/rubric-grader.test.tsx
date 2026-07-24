import type { JSX } from "react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RubricGrader, type RubricCriterion, type RubricValue } from "./rubric-grader";

const criteria: RubricCriterion[] = [
  { id: "c1", label: "Code quality", maxScore: 10 },
  { id: "c2", label: "Documentation", maxScore: 5, description: "Check inline comments." },
];

const emptyValue: RubricValue = { scores: { c1: null, c2: null }, feedback: "" };

/** Uncontrolled wrapper that actually propagates onChange back to state. */
function StatefulHarness({
  onChange,
  initial = emptyValue,
  readOnly,
}: {
  onChange?: (v: RubricValue) => void;
  initial?: RubricValue;
  readOnly?: boolean;
}): JSX.Element {
  const [value, setValue] = React.useState<RubricValue>(initial);
  return (
    <RubricGrader
      criteria={criteria}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      readOnly={readOnly}
    />
  );
}

/** Static (non-updating) harness for tests that only care about rendering. */
function Harness({
  onChange,
  value = emptyValue,
  readOnly,
}: {
  onChange?: (v: RubricValue) => void;
  value?: RubricValue;
  readOnly?: boolean;
}): JSX.Element {
  return (
    <RubricGrader
      criteria={criteria}
      value={value}
      onChange={onChange ?? vi.fn()}
      readOnly={readOnly}
    />
  );
}

describe("RubricGrader", () => {
  // ---------------------------------------------------------------------------
  // Unit tests
  // ---------------------------------------------------------------------------

  it("renders all criteria labels", () => {
    render(<Harness />);
    expect(screen.getByText("Code quality")).toBeInTheDocument();
    expect(screen.getByText("Documentation")).toBeInTheDocument();
  });

  it("shows criterion description when provided", () => {
    render(<Harness />);
    expect(screen.getByTestId("rubric-criterion-desc-c2")).toHaveTextContent(
      "Check inline comments.",
    );
  });

  it("renders score inputs labelled with criterion name and max", () => {
    render(<Harness />);
    const input = screen.getByRole("spinbutton", {
      name: /Code quality score out of 10/i,
    });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "10");
  });

  it("calls onChange with the updated score when user types in an input", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("spinbutton", {
      name: /Code quality score out of 10/i,
    });
    await user.clear(input);
    await user.type(input, "8");
    // Last call should have c1=8
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scores: expect.objectContaining({ c1: 8 }),
      }),
    );
  });

  it("calls onChange with the updated feedback when user types in feedback textarea", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StatefulHarness onChange={onChange} />);
    const textarea = screen.getByTestId("rubric-grader-feedback");
    await user.type(textarea, "Great work!");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ feedback: "Great work!" }),
    );
  });

  it("displays total score as sum of awarded scores", () => {
    render(
      <Harness
        value={{ scores: { c1: 8, c2: 4 }, feedback: "" }}
      />,
    );
    // 8+4=12 out of 15
    expect(screen.getByLabelText("12 out of 15 points")).toBeInTheDocument();
  });

  it("shows unscored note when not all criteria are scored", () => {
    render(
      <Harness value={{ scores: { c1: 8, c2: null }, feedback: "" }} />,
    );
    const scoreLabel = screen.getByLabelText(/not all criteria scored/i);
    expect(scoreLabel).toBeInTheDocument();
  });

  it("disables all inputs in readOnly mode", () => {
    render(<Harness readOnly />);
    const inputs = screen.getAllByRole("spinbutton");
    for (const input of inputs) {
      expect(input).toBeDisabled();
    }
    expect(screen.getByTestId("rubric-grader-feedback")).toBeDisabled();
  });

  it("clamps score to criterion maxScore (no negative allowed)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StatefulHarness onChange={onChange} />);
    const input = screen.getByRole("spinbutton", {
      name: /Code quality score out of 10/i,
    });
    await user.clear(input);
    await user.type(input, "15");
    // Component clamps at max (10)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scores: expect.objectContaining({ c1: 10 }),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // a11y tests
  // ---------------------------------------------------------------------------

  it("score inputs are inside a fieldset with a sr-only legend", () => {
    const { container } = render(<Harness />);
    const fieldset = container.querySelector("fieldset");
    expect(fieldset).toBeInTheDocument();
    const legend = fieldset?.querySelector("legend");
    expect(legend?.textContent).toContain("Rubric criteria scores");
  });

  it("each score input has an explicit label via htmlFor → id linkage", () => {
    render(<Harness />);
    // getByRole("spinbutton", { name: ... }) relies on the label being correctly linked.
    const c1Input = screen.getByRole("spinbutton", {
      name: /Code quality score out of 10/i,
    });
    expect(c1Input).toBeInTheDocument();
    const c2Input = screen.getByRole("spinbutton", {
      name: /Documentation score out of 5/i,
    });
    expect(c2Input).toBeInTheDocument();
  });

  it("total score region is aria-live polite so score updates announce to SR", () => {
    const { container } = render(<Harness />);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  it("exposes data-testid", () => {
    render(<Harness />);
    expect(screen.getByTestId("rubric-grader")).toBeInTheDocument();
  });

  it("criterion containers are identifiable by test id", () => {
    render(<Harness />);
    expect(screen.getByTestId("rubric-criterion-c1")).toBeInTheDocument();
    expect(screen.getByTestId("rubric-criterion-c2")).toBeInTheDocument();
  });

  it("feedback textarea has a label", () => {
    render(<Harness />);
    // getByRole with name confirms the <label> htmlFor link works
    expect(screen.getByRole("textbox", { name: /Overall feedback/i })).toBeInTheDocument();
  });
});
