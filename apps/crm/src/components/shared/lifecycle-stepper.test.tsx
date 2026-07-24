// LifecycleStepper — the "you are here" journey path (lifecycle-redesign P2).
// Asserts the 8-phase spine renders, the current phase carries aria-current +
// data-state="current", passed phases read done / future ones upcoming, and the
// two terminal off-ramps swap the sr-only progress summary for a danger note.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LifecycleStepper } from "./lifecycle-stepper";

const PHASES = ["lead", "registration", "program", "payment", "active", "learning", "completed", "certified"];

function stateOf(phase: string): string | null {
  return screen.getByTestId(`lifecycle-step-${phase}`).getAttribute("data-state");
}

describe("LifecycleStepper — forward ladder", () => {
  it("renders all 8 journey phases", () => {
    render(<LifecycleStepper stage="new_lead" />);
    for (const phase of PHASES) {
      expect(screen.getByTestId(`lifecycle-step-${phase}`)).toBeInTheDocument();
    }
  });

  it("a brand-new lead sits on the Lead phase with everything ahead upcoming", () => {
    render(<LifecycleStepper stage="new_lead" />);
    expect(stateOf("lead")).toBe("current");
    expect(screen.getByTestId("lifecycle-step-lead")).toHaveAttribute("aria-current", "step");
    for (const phase of PHASES.slice(1)) expect(stateOf(phase)).toBe("upcoming");
  });

  it("payment_pending marks lead/registration/program done, payment current, the rest upcoming", () => {
    render(<LifecycleStepper stage="payment_pending" />);
    expect(stateOf("lead")).toBe("done");
    expect(stateOf("registration")).toBe("done");
    expect(stateOf("program")).toBe("done");
    expect(stateOf("payment")).toBe("current");
    expect(stateOf("active")).toBe("upcoming");
    expect(stateOf("certified")).toBe("upcoming");
  });

  it("detailed stages within one phase resolve to the same step (interested → Lead)", () => {
    render(<LifecycleStepper stage="interested" />);
    expect(stateOf("lead")).toBe("current");
    expect(stateOf("registration")).toBe("upcoming");
  });

  it("certified completes the ladder: 7 phases done, certified current", () => {
    render(<LifecycleStepper stage="certified" />);
    expect(stateOf("certified")).toBe("current");
    for (const phase of PHASES.slice(0, -1)) expect(stateOf(phase)).toBe("done");
  });
});

describe("LifecycleStepper — terminal off-ramps", () => {
  it("lost renders the journey-ended note after the Lead phase, with no current step", () => {
    render(<LifecycleStepper stage="lost" />);
    expect(screen.getByTestId("lifecycle-stepper-offramp")).toHaveTextContent(/lead marked lost/i);
    expect(screen.getByTestId("lifecycle-stepper-offramp")).toHaveTextContent(/Lead phase/);
    expect(document.querySelector('[data-state="current"]')).toBeNull();
  });

  it("dropped notes the exit after the Active phase (they were really enrolled)", () => {
    render(<LifecycleStepper stage="dropped" />);
    expect(screen.getByTestId("lifecycle-stepper-offramp")).toHaveTextContent(/student dropped/i);
    expect(screen.getByTestId("lifecycle-stepper-offramp")).toHaveTextContent(/Active phase/);
  });
});
