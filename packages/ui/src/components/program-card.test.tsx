import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProgramCard } from "./program-card";

describe("ProgramCard — rendering", () => {
  it("renders with default data-testid='program-card'", () => {
    render(<ProgramCard title="Python for Data Science" />);
    expect(screen.getByTestId("program-card")).toBeInTheDocument();
  });

  it("renders the title in a heading", () => {
    render(<ProgramCard title="Python for Data Science" />);
    expect(screen.getByRole("heading", { name: "Python for Data Science" })).toBeInTheDocument();
  });

  it("renders domain chip when provided", () => {
    render(<ProgramCard title="T" domain="Data Science" />);
    expect(screen.getByText("Data Science")).toBeInTheDocument();
  });

  it("renders meta row: duration, mode, level", () => {
    render(
      <ProgramCard
        title="T"
        duration="12 weeks"
        mode="Live + Recorded"
        level="Beginner"
      />,
    );
    expect(screen.getByText("12 weeks")).toBeInTheDocument();
    expect(screen.getByText("Live + Recorded")).toBeInTheDocument();
    expect(screen.getByText("Beginner")).toBeInTheDocument();
  });

  it("renders price and EMI", () => {
    render(
      <ProgramCard title="T" priceDisplay="₹12,999" emiDisplay="EMI from ₹1,100/mo" />,
    );
    expect(screen.getByText("₹12,999")).toBeInTheDocument();
    expect(screen.getByText("EMI from ₹1,100/mo")).toBeInTheDocument();
  });

  it("renders rating with aria-label (not color-only)", () => {
    render(<ProgramCard title="T" ratingAvg={4.8} ratingCount={312} />);
    // aria-label contains the numeric value
    const ratingEl = screen.getByLabelText(/rated 4.8 out of 5/i);
    expect(ratingEl).toBeInTheDocument();
  });

  it("renders CTA as a link when ctaHref is provided", () => {
    render(
      <ProgramCard title="T" ctaLabel="Explore Program" ctaHref="/programs/python" />,
    );
    const link = screen.getByRole("link", { name: "Explore Program" });
    expect(link).toHaveAttribute("href", "/programs/python");
  });

  it("renders CTA as a button when no ctaHref", () => {
    const onCtaClick = vi.fn();
    render(
      <ProgramCard title="T" ctaLabel="Explore" onCtaClick={onCtaClick} />,
    );
    expect(screen.getByRole("button", { name: "Explore" })).toBeInTheDocument();
  });

  it("calls onCtaClick when the button CTA is clicked", async () => {
    const user = userEvent.setup();
    const onCtaClick = vi.fn();
    render(<ProgramCard title="T" ctaLabel="Explore" onCtaClick={onCtaClick} />);
    await user.click(screen.getByRole("button", { name: "Explore" }));
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });
});

describe("ProgramCard — a11y", () => {
  it("uses an <article> element", () => {
    const { container } = render(<ProgramCard title="T" />);
    expect(container.querySelector("article")).toBeInTheDocument();
  });

  it("icon slot is aria-hidden", () => {
    const { container } = render(
      <ProgramCard title="T" icon={<svg data-testid="domain-icon" />} />,
    );
    const iconWrapper = container.querySelector("[aria-hidden='true']");
    expect(iconWrapper).toBeInTheDocument();
  });

  it("CTA button has min-h of 44px via class", () => {
    render(<ProgramCard title="T" ctaLabel="Click" />);
    const btn = screen.getByRole("button", { name: "Click" });
    expect(btn.className).toContain("min-h-[44px]");
  });
});
