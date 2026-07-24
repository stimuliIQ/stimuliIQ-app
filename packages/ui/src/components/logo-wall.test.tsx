import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LogoWall } from "./logo-wall";

const logos = [
  { name: "TCS", src: "/logos/tcs.svg" },
  { name: "Infosys", src: "/logos/infosys.svg" },
  { name: "Wipro", src: "/logos/wipro.svg" },
];

describe("LogoWall — rendering", () => {
  it("renders with default data-testid='logo-wall'", () => {
    render(<LogoWall logos={logos} />);
    expect(screen.getByTestId("logo-wall")).toBeInTheDocument();
  });

  it("renders heading when provided", () => {
    render(<LogoWall logos={logos} heading="Our Hiring Partners" />);
    expect(screen.getByText("Our Hiring Partners")).toBeInTheDocument();
  });

  it("renders all logos with alt text", () => {
    render(<LogoWall logos={logos} />);
    expect(screen.getByAltText("TCS")).toBeInTheDocument();
    expect(screen.getByAltText("Infosys")).toBeInTheDocument();
    expect(screen.getByAltText("Wipro")).toBeInTheDocument();
  });

  it("renders logos with loading=lazy", () => {
    const { container } = render(<LogoWall logos={logos} />);
    const images = container.querySelectorAll("img");
    images.forEach((img) => {
      expect(img).toHaveAttribute("loading", "lazy");
    });
  });
});

describe("LogoWall — a11y", () => {
  it("has a <section> with aria-label", () => {
    render(<LogoWall logos={logos} heading="Our Partners" />);
    expect(screen.getByRole("region", { name: "Our Partners" })).toBeInTheDocument();
  });

  it("logo images have non-empty alt text (company name)", () => {
    const { container } = render(<LogoWall logos={logos} />);
    const images = container.querySelectorAll("img");
    images.forEach((img) => {
      expect(img.getAttribute("alt")).toBeTruthy();
    });
  });
});
