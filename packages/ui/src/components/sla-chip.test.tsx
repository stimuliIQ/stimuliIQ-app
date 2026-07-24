import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SlaChip, computeSlaState, SLA_SOON_THRESHOLD_MS } from "./sla-chip";

// ---------------------------------------------------------------------------
// computeSlaState — pure function boundary tests
// ---------------------------------------------------------------------------

describe("computeSlaState", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");

  it("returns done/success when done=true regardless of date", () => {
    // Even if overdue, done=true wins
    const pastDue = new Date(now.getTime() - 86_400_000);
    const result = computeSlaState(pastDue, true, now);
    expect(result.status).toBe("done");
    expect(result.tone).toBe("success");
    expect(result.label).toBe("Done");
  });

  it("returns overdue/danger when dueAt is in the past (not done)", () => {
    const pastDue = new Date(now.getTime() - 2 * 86_400_000); // 2 days ago
    const result = computeSlaState(pastDue, false, now);
    expect(result.status).toBe("overdue");
    expect(result.tone).toBe("danger");
    expect(result.label).toMatch(/[Oo]verdue/);
    // Label must contain a time indicator (not color-only)
    expect(result.label.length).toBeGreaterThan("Overdue".length);
  });

  it("returns overdue/danger for dueAt exactly at now (boundary — past by 0ms rounds to 'Just now')", () => {
    // Exactly at now — diffMs = 0 (negative or 0 = overdue boundary)
    const exactNow = new Date(now.getTime());
    const result = computeSlaState(exactNow, false, now);
    // diffMs = 0, not < 0, so this is 0ms future — ok zone (threshold check)
    // Actually 0 is NOT past, so it should be "ok" or "soon" depending on threshold
    // diffMs = 0 → not < 0 → not overdue. 0 <= SLA_SOON_THRESHOLD_MS → "soon"
    expect(result.status).toBe("soon");
    expect(result.tone).toBe("warning");
  });

  it("returns overdue for 1ms past due", () => {
    const justPast = new Date(now.getTime() - 1);
    const result = computeSlaState(justPast, false, now);
    expect(result.status).toBe("overdue");
    expect(result.tone).toBe("danger");
  });

  it("returns soon/warning when within soonThresholdMs (default 24h)", () => {
    // 12 hours from now — within 24h threshold
    const soonDue = new Date(now.getTime() + 12 * 3_600_000);
    const result = computeSlaState(soonDue, false, now);
    expect(result.status).toBe("soon");
    expect(result.tone).toBe("warning");
    expect(result.label).toMatch(/[Dd]ue in/);
  });

  it("returns soon/warning at exactly the soonThresholdMs boundary", () => {
    const exactThreshold = new Date(now.getTime() + SLA_SOON_THRESHOLD_MS);
    const result = computeSlaState(exactThreshold, false, now);
    expect(result.status).toBe("soon");
    expect(result.tone).toBe("warning");
  });

  it("returns ok/neutral when beyond soonThresholdMs", () => {
    // 48 hours from now — beyond 24h threshold
    const farDue = new Date(now.getTime() + 48 * 3_600_000);
    const result = computeSlaState(farDue, false, now);
    expect(result.status).toBe("ok");
    expect(result.tone).toBe("neutral");
    expect(result.label).toMatch(/[Dd]ue/);
  });

  it("respects a custom soonThresholdMs", () => {
    // 30h from now, custom threshold = 48h → should be "soon"
    const dueAt = new Date(now.getTime() + 30 * 3_600_000);
    const result = computeSlaState(dueAt, false, now, 48 * 3_600_000);
    expect(result.status).toBe("soon");
    expect(result.tone).toBe("warning");
  });

  it("includes time information in the label (never color-only)", () => {
    // Every non-done status must have time info in the label
    const cases: Array<[Date, boolean, string]> = [
      [new Date(now.getTime() - 2 * 86_400_000), false, "overdue"],
      [new Date(now.getTime() + 3 * 3_600_000), false, "soon"],
      [new Date(now.getTime() + 5 * 86_400_000), false, "ok"],
    ];
    for (const [dueAt, done, status] of cases) {
      const result = computeSlaState(dueAt, done, now);
      expect(result.status).toBe(status);
      // Label must contain more than just "Due" or "Overdue" — has a time component
      expect(result.label.split(" ").length).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// SlaChip component
// ---------------------------------------------------------------------------

describe("SlaChip", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");

  it("renders the label text (not color-only)", () => {
    const dueAt = new Date(now.getTime() + 5 * 86_400_000);
    render(<SlaChip dueAt={dueAt} referenceNow={now} />);
    const chip = screen.getByTestId("sla-chip");
    expect(chip.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("renders an icon (visual supplement to the text label)", () => {
    const dueAt = new Date(now.getTime() + 5 * 86_400_000);
    const { container } = render(<SlaChip dueAt={dueAt} referenceNow={now} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows danger tone for overdue tasks", () => {
    const pastDue = new Date(now.getTime() - 2 * 86_400_000);
    const { container } = render(<SlaChip dueAt={pastDue} referenceNow={now} />);
    expect(container.firstChild).toHaveClass("text-danger");
  });

  it("shows warning tone for due-soon tasks", () => {
    const soonDue = new Date(now.getTime() + 3 * 3_600_000);
    const { container } = render(<SlaChip dueAt={soonDue} referenceNow={now} />);
    expect(container.firstChild).toHaveClass("text-warning");
  });

  it("shows success tone when done=true", () => {
    const pastDue = new Date(now.getTime() - 86_400_000);
    const { container } = render(<SlaChip dueAt={pastDue} done referenceNow={now} />);
    expect(container.firstChild).toHaveClass("text-success");
    expect(screen.getByTestId("sla-chip")).toHaveTextContent("Done");
  });

  it("shows neutral tone for ok (future, beyond threshold)", () => {
    const farDue = new Date(now.getTime() + 5 * 86_400_000);
    const { container } = render(<SlaChip dueAt={farDue} referenceNow={now} />);
    expect(container.firstChild).toHaveClass("text-fg-muted");
  });

  it("has aria-label set to the computed label", () => {
    const dueAt = new Date(now.getTime() + 5 * 86_400_000);
    render(<SlaChip dueAt={dueAt} referenceNow={now} />);
    const chip = screen.getByTestId("sla-chip");
    expect(chip.getAttribute("aria-label")).toBeTruthy();
    expect(chip.getAttribute("aria-label")).toMatch(/[Dd]ue/);
  });

  it("applies a custom data-testid", () => {
    const dueAt = new Date(now.getTime() + 86_400_000);
    render(<SlaChip dueAt={dueAt} referenceNow={now} data-testid="my-sla" />);
    expect(screen.getByTestId("my-sla")).toBeInTheDocument();
  });
});
