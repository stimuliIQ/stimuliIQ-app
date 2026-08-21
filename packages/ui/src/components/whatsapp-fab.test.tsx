import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { WhatsAppFab } from "./whatsapp-fab";

const href = "https://wa.me/919876543210?text=Hello";

describe("WhatsAppFab, rendering", () => {
  it("renders with default data-testid='whatsapp-fab'", () => {
    render(<WhatsAppFab href={href} />);
    expect(screen.getByTestId("whatsapp-fab")).toBeInTheDocument();
  });

  it("renders as an <a> element with the provided href", () => {
    render(<WhatsAppFab href={href} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", href);
  });

  it("opens in a new tab (target=_blank)", () => {
    render(<WhatsAppFab href={href} />);
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("has rel=noopener noreferrer", () => {
    render(<WhatsAppFab href={href} />);
    expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("has the default aria-label", () => {
    render(<WhatsAppFab href={href} />);
    expect(screen.getByRole("link", { name: "Chat with us on WhatsApp" })).toBeInTheDocument();
  });

  it("accepts a custom aria-label", () => {
    render(<WhatsAppFab href={href} aria-label="WhatsApp us" />);
    expect(screen.getByRole("link", { name: "WhatsApp us" })).toBeInTheDocument();
  });

  it("renders the WhatsApp SVG icon as aria-hidden", () => {
    const { container } = render(<WhatsAppFab href={href} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("WhatsAppFab, a11y", () => {
  it("has a valid non-empty aria-label (icon button a11y requirement)", () => {
    render(<WhatsAppFab href={href} />);
    const link = screen.getByRole("link");
    const label = link.getAttribute("aria-label");
    expect(label).toBeTruthy();
    expect(label!.length).toBeGreaterThan(0);
  });

  it("is ≥44px (size-14 = 56px in Tailwind)", () => {
    render(<WhatsAppFab href={href} />);
    // Check the class contains size-14
    expect(screen.getByRole("link").className).toContain("size-14");
  });
});
