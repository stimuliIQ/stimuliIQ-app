import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CampaignBuilder } from "./campaign-builder";

const SEGMENTS = <div>Segment step content</div>;
const TEMPLATE = <div>Template step content</div>;
const SCHEDULE = <div>Schedule step content</div>;
const REVIEW = <div>Review step content</div>;

function renderBuilder(currentStep = 0, overrides = {}) {
  const defaults = {
    currentStep,
    onNext: vi.fn(),
    onBack: vi.fn(),
    onSubmit: vi.fn(),
    segmentStep: SEGMENTS,
    templateStep: TEMPLATE,
    scheduleStep: SCHEDULE,
    reviewStep: REVIEW,
  };
  return render(<CampaignBuilder {...defaults} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("CampaignBuilder — rendering", () => {
  it("renders with default data-testid='campaign-builder'", () => {
    renderBuilder();
    expect(screen.getByTestId("campaign-builder")).toBeInTheDocument();
  });

  it("renders the MultiStepForm inside it", () => {
    renderBuilder();
    expect(screen.getByTestId("multi-step-form")).toBeInTheDocument();
  });

  it("renders step 1 — Audience heading + content", () => {
    renderBuilder(0);
    expect(screen.getByRole("heading", { level: 2, name: "Audience" })).toBeInTheDocument();
    expect(screen.getByText("Segment step content")).toBeInTheDocument();
  });

  it("renders step 2 — Template", () => {
    renderBuilder(1);
    expect(screen.getByRole("heading", { level: 2, name: "Template" })).toBeInTheDocument();
    expect(screen.getByText("Template step content")).toBeInTheDocument();
  });

  it("renders step 3 — Schedule", () => {
    renderBuilder(2);
    expect(screen.getByRole("heading", { level: 2, name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Schedule step content")).toBeInTheDocument();
  });

  it("renders step 4 — Review with submit label", () => {
    renderBuilder(3);
    expect(screen.getByRole("heading", { level: 2, name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("Review step content")).toBeInTheDocument();
  });

  it("shows 'Send campaign' submit button on last step", () => {
    renderBuilder(3);
    expect(screen.getByRole("button", { name: "Send campaign" })).toBeInTheDocument();
  });

  it("shows a custom submit label when provided", () => {
    renderBuilder(3, { submitLabel: "Schedule send" });
    expect(screen.getByRole("button", { name: "Schedule send" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// a11y — inherits from MultiStepForm
// ---------------------------------------------------------------------------

describe("CampaignBuilder — a11y", () => {
  it("has a progressbar tracking steps", () => {
    const { container } = renderBuilder(0);
    // The progressbar lives inside an aria-hidden div in MultiStepForm (visual only),
    // so we use container.querySelector instead of getByRole.
    const bar = container.querySelector("[role='progressbar']");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
  });

  it("has an aria-live='polite' region for step announcements", () => {
    const { container } = renderBuilder(0);
    const liveRegion = container.querySelector("[aria-live='polite']");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion?.textContent).toContain("Step 1 of 4: Audience");
  });

  it("renders global form error with role=alert", () => {
    renderBuilder(0, { formError: "API error occurred." });
    expect(screen.getByRole("alert")).toHaveTextContent("API error occurred.");
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("CampaignBuilder — navigation", () => {
  it("calls onNext when Continue is clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    renderBuilder(0, { onNext });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("calls onBack when Back is clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderBuilder(2, { onBack });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
