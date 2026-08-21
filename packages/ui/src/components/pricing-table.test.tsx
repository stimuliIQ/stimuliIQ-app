import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PricingTable, type PricingTier, type PricingFeatureRow } from "./pricing-table";

const tiers: PricingTier[] = [
  {
    id: "basic",
    name: "Self-Paced",
    priceDisplay: "₹8,999",
    features: ["Recorded videos", "Certificate"],
    ctaLabel: "Enroll",
    ctaHref: "/enroll/basic",
  },
  {
    id: "live",
    name: "Live + Recorded",
    priceDisplay: "₹12,999",
    recommended: true,
    features: ["Everything in Self-Paced", "Live sessions", "Placement support"],
    ctaLabel: "Enroll",
    ctaHref: "/enroll/live",
  },
];

const featureRows: PricingFeatureRow[] = [
  { label: "Recorded videos", values: { basic: true, live: true } },
  { label: "Live sessions", values: { basic: false, live: true } },
  { label: "Placement support", values: { basic: false, live: true } },
];

// ---------------------------------------------------------------------------
// Cards variant
// ---------------------------------------------------------------------------

describe("PricingTable cards variant", () => {
  it("renders with default data-testid='pricing-table'", () => {
    render(<PricingTable tiers={tiers} />);
    expect(screen.getByTestId("pricing-table")).toBeInTheDocument();
  });

  it("renders each tier name", () => {
    render(<PricingTable tiers={tiers} />);
    expect(screen.getByRole("heading", { name: "Self-Paced" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Live + Recorded" })).toBeInTheDocument();
  });

  it("renders prices", () => {
    render(<PricingTable tiers={tiers} />);
    expect(screen.getByText("₹8,999")).toBeInTheDocument();
    expect(screen.getByText("₹12,999")).toBeInTheDocument();
  });

  it("marks the recommended tier with a badge", () => {
    render(<PricingTable tiers={tiers} />);
    const badges = screen.getAllByText("Recommended");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("renders feature list items", () => {
    render(<PricingTable tiers={tiers} />);
    expect(screen.getByText("Recorded videos")).toBeInTheDocument();
    expect(screen.getByText("Live sessions")).toBeInTheDocument();
    expect(screen.getByText("Placement support")).toBeInTheDocument();
  });

  it("CTA links have correct hrefs", () => {
    render(<PricingTable tiers={tiers} />);
    const links = screen.getAllByRole("link", { name: "Enroll" });
    expect(links[0]).toHaveAttribute("href", "/enroll/basic");
    expect(links[1]).toHaveAttribute("href", "/enroll/live");
  });

  it("CTA buttons call onCtaClick", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    const tiersWithCallback: PricingTier[] = [
      { id: "t", name: "T", priceDisplay: "₹9,999", features: [], ctaLabel: "Go", onCtaClick: fn },
    ];
    render(<PricingTable tiers={tiersWithCallback} />);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Comparison variant
// ---------------------------------------------------------------------------

describe("PricingTable comparison variant", () => {
  it("renders a <table> element", () => {
    const { container } = render(
      <PricingTable variant="comparison" tiers={tiers} featureRows={featureRows} />,
    );
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("renders column headers for each tier", () => {
    render(
      <PricingTable variant="comparison" tiers={tiers} featureRows={featureRows} />,
    );
    expect(screen.getByRole("columnheader", { name: "Self-Paced" })).toBeInTheDocument();
    // The recommended tier has extra label in aria-label
    expect(
      screen.getByRole("columnheader", { name: /Live \+ Recorded, Recommended/i }),
    ).toBeInTheDocument();
  });

  it("renders feature row labels as row headers", () => {
    render(
      <PricingTable variant="comparison" tiers={tiers} featureRows={featureRows} />,
    );
    expect(screen.getByRole("rowheader", { name: "Recorded videos" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Live sessions" })).toBeInTheDocument();
  });

  it("renders Included/Not included icons for boolean values", () => {
    render(
      <PricingTable variant="comparison" tiers={tiers} featureRows={featureRows} />,
    );
    // "Live sessions" is true for live, false for basic
    const included = screen.getAllByLabelText("Included");
    const notIncluded = screen.getAllByLabelText("Not included");
    expect(included.length).toBeGreaterThan(0);
    expect(notIncluded.length).toBeGreaterThan(0);
  });
});
