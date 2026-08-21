import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MultiStepForm, type MultiStep } from "./multi-step-form";

const steps: MultiStep[] = [
  { id: "step1", title: "Choose Program", content: <div>Step 1 content</div> },
  { id: "step2", title: "Pick a Slot", content: <div>Step 2 content</div> },
  { id: "step3", title: "Your Details", content: <div>Step 3 content</div> },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("MultiStepForm, rendering", () => {
  it("renders with default data-testid='multi-step-form'", () => {
    render(<MultiStepForm steps={steps} currentStep={0} />);
    expect(screen.getByTestId("multi-step-form")).toBeInTheDocument();
  });

  it("renders the current step heading", () => {
    render(<MultiStepForm steps={steps} currentStep={0} />);
    expect(screen.getByRole("heading", { level: 2, name: "Choose Program" })).toBeInTheDocument();
  });

  it("renders the current step content", () => {
    render(<MultiStepForm steps={steps} currentStep={1} />);
    expect(screen.getByText("Step 2 content")).toBeInTheDocument();
  });

  it("renders progress indicator", () => {
    const { container } = render(<MultiStepForm steps={steps} currentStep={0} />);
    const bar = container.querySelector("[role='progressbar']");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
  });

  it("renders step indicator list with aria-label", () => {
    render(<MultiStepForm steps={steps} currentStep={0} />);
    expect(screen.getByRole("list", { name: "Form steps" })).toBeInTheDocument();
  });

  it("marks the current step item with aria-current='step'", () => {
    render(<MultiStepForm steps={steps} currentStep={1} />);
    const items = screen.getAllByRole("listitem");
    // The item at index 1 (0-based) should have aria-current="step"
    const currentItem = items.find((i) => i.getAttribute("aria-current") === "step");
    expect(currentItem).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("MultiStepForm, navigation", () => {
  it("calls onNext when Continue is clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <MultiStepForm steps={steps} currentStep={0} onNext={onNext} />,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("calls onBack when Back is clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <MultiStepForm steps={steps} currentStep={1} onBack={onBack} />,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides Back button on step 0 (invisible class)", () => {
    render(<MultiStepForm steps={steps} currentStep={0} />);
    const backBtn = screen.getByRole("button", { name: "Back" });
    expect(backBtn.className).toContain("invisible");
  });

  it("renders Submit button on the last step", () => {
    render(
      <MultiStepForm
        steps={steps}
        currentStep={2}
        isLastStep
        submitLabel="Book My Slot"
      />,
    );
    expect(screen.getByRole("button", { name: "Book My Slot" })).toBeInTheDocument();
  });

  it("calls onSubmit when Submit is clicked on last step", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MultiStepForm
        steps={steps}
        currentStep={2}
        isLastStep
        onSubmit={onSubmit}
        submitLabel="Submit"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables nav buttons and shows spinner when isSubmitting=true", () => {
    render(
      <MultiStepForm
        steps={steps}
        currentStep={2}
        isLastStep
        isSubmitting
        submitLabel="Submit"
      />,
    );
    const submitBtn = screen.getByRole("button", { name: /submitting/i });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute("aria-busy", "true");
  });
});

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

describe("MultiStepForm, errors", () => {
  it("renders global form error with role=alert", () => {
    render(
      <MultiStepForm
        steps={steps}
        currentStep={0}
        formError="Something went wrong. Please try again."
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y, live region
// ---------------------------------------------------------------------------

describe("MultiStepForm, a11y", () => {
  it("has an aria-live='polite' region for step announcements", () => {
    const { container } = render(
      <MultiStepForm steps={steps} currentStep={0} />,
    );
    const liveRegion = container.querySelector("[aria-live='polite']");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion?.textContent).toContain("Step 1 of 3: Choose Program");
  });

  it("step heading has tabIndex=-1 for programmatic focus", () => {
    render(<MultiStepForm steps={steps} currentStep={0} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Choose Program" });
    expect(heading).toHaveAttribute("tabindex", "-1");
  });
});
