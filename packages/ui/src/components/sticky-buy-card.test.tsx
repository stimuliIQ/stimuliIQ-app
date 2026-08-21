import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StickyBuyCard, MobileBuyBar } from "./sticky-buy-card";

describe("StickyBuyCard, rendering", () => {
  it("renders with default data-testid='sticky-buy-card'", () => {
    render(<StickyBuyCard priceDisplay="₹12,999" />);
    expect(screen.getByTestId("sticky-buy-card")).toBeInTheDocument();
  });

  it("renders the price", () => {
    render(<StickyBuyCard priceDisplay="₹12,999" />);
    expect(screen.getByText("₹12,999")).toBeInTheDocument();
  });

  it("renders original price with line-through class", () => {
    render(
      <StickyBuyCard priceDisplay="₹12,999" originalPriceDisplay="₹18,999" />,
    );
    const original = screen.getByText("₹18,999");
    expect(original.className).toContain("line-through");
  });

  it("renders EMI blurb", () => {
    render(<StickyBuyCard priceDisplay="₹12,999" emiDisplay="or ₹1,100/mo" />);
    expect(screen.getByText("or ₹1,100/mo")).toBeInTheDocument();
  });

  it("renders primary CTA as link when href provided", () => {
    render(
      <StickyBuyCard priceDisplay="₹12,999" primaryCtaLabel="Enroll Now" primaryCtaHref="/enroll" />,
    );
    expect(screen.getByRole("link", { name: "Enroll Now" })).toHaveAttribute("href", "/enroll");
  });

  it("renders primary CTA as button when no href", () => {
    const fn = vi.fn();
    render(
      <StickyBuyCard priceDisplay="₹12,999" primaryCtaLabel="Enroll Now" onPrimaryCtaClick={fn} />,
    );
    expect(screen.getByRole("button", { name: "Enroll Now" })).toBeInTheDocument();
  });

  it("calls onPrimaryCtaClick", async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(
      <StickyBuyCard priceDisplay="₹12,999" primaryCtaLabel="Enroll Now" onPrimaryCtaClick={fn} />,
    );
    await user.click(screen.getByRole("button", { name: "Enroll Now" }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("renders included list", () => {
    render(
      <StickyBuyCard
        priceDisplay="₹12,999"
        included={["Certificate", "Placement support"]}
      />,
    );
    expect(screen.getByText("Certificate")).toBeInTheDocument();
    expect(screen.getByText("Placement support")).toBeInTheDocument();
  });
});

describe("StickyBuyCard, a11y", () => {
  it("has aria-label on the aside", () => {
    render(<StickyBuyCard priceDisplay="₹12,999" />);
    expect(screen.getByRole("complementary", { name: "Program enrollment" })).toBeInTheDocument();
  });

  it("primary CTA button has min-h-[44px] class", () => {
    render(<StickyBuyCard priceDisplay="₹12,999" primaryCtaLabel="Enroll" />);
    const btn = screen.getByRole("button", { name: "Enroll" });
    expect(btn.className).toContain("min-h-[44px]");
  });
});

describe("MobileBuyBar, rendering", () => {
  it("renders with default data-testid='mobile-buy-bar'", () => {
    render(<MobileBuyBar priceDisplay="₹12,999" />);
    expect(screen.getByTestId("mobile-buy-bar")).toBeInTheDocument();
  });

  it("renders price with aria-live region", () => {
    const { container } = render(<MobileBuyBar priceDisplay="₹12,999" />);
    const liveRegion = container.querySelector("[aria-live='polite']");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion?.textContent).toContain("₹12,999");
  });

  it("renders CTA as link when href provided", () => {
    render(
      <MobileBuyBar priceDisplay="₹12,999" primaryCtaLabel="Enroll" primaryCtaHref="/enroll" />,
    );
    expect(screen.getByRole("link", { name: "Enroll" })).toHaveAttribute("href", "/enroll");
  });

  it("CTA has min-h-[44px] class", () => {
    render(<MobileBuyBar priceDisplay="₹12,999" primaryCtaLabel="Enroll" />);
    const btn = screen.getByRole("button", { name: "Enroll" });
    expect(btn.className).toContain("min-h-[44px]");
  });
});
