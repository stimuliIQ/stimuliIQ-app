import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { HeroSplit } from "./hero-split";

describe("HeroSplit, rendering", () => {
  it("renders with default data-testid='hero-split'", () => {
    render(<HeroSplit heading="Learn. Build. Get Hired." />);
    expect(screen.getByTestId("hero-split")).toBeInTheDocument();
  });

  it("renders the heading as h1 by default", () => {
    render(<HeroSplit heading="Test Hero" />);
    expect(screen.getByRole("heading", { level: 1, name: "Test Hero" })).toBeInTheDocument();
  });

  it("renders the heading as h2 when headingLevel=2", () => {
    render(<HeroSplit heading="Test Hero" headingLevel={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "Test Hero" })).toBeInTheDocument();
  });

  it("renders eyebrow text", () => {
    render(<HeroSplit heading="H" eyebrow="India's #1 EdTech" />);
    expect(screen.getByText("India's #1 EdTech")).toBeInTheDocument();
  });

  it("renders subheading", () => {
    render(<HeroSplit heading="H" subheading="Project-based learning" />);
    expect(screen.getByText("Project-based learning")).toBeInTheDocument();
  });

  it("renders primaryCta and secondaryCta slots", () => {
    render(
      <HeroSplit
        heading="H"
        primaryCta={<a href="/explore">Explore Programs</a>}
        secondaryCta={<a href="/book">Book Free Slot</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "Explore Programs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Free Slot" })).toBeInTheDocument();
  });

  it("renders trust strip slot", () => {
    render(
      <HeroSplit
        heading="H"
        trustStrip={<div data-testid="trust-strip">15K+ students</div>}
      />,
    );
    expect(screen.getByTestId("trust-strip")).toBeInTheDocument();
  });
});

describe("HeroSplit, a11y", () => {
  it("has a section landmark with aria-label", () => {
    render(<HeroSplit heading="H" />);
    expect(screen.getByRole("region", { name: "Hero section" })).toBeInTheDocument();
  });

  it("visual slot has aria-hidden", () => {
    const { container } = render(
      <HeroSplit heading="H" visual={<img src="/hero.jpg" alt="hero" />} />,
    );
    const visualDiv = container.querySelector("[aria-hidden='true']");
    expect(visualDiv).toBeInTheDocument();
  });
});
