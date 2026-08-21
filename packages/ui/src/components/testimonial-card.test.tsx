import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TestimonialCard } from "./testimonial-card";

describe("TestimonialCard, rendering", () => {
  it("renders with default data-testid='testimonial-card'", () => {
    render(<TestimonialCard quote="Great program!" studentName="Aditya R." />);
    expect(screen.getByTestId("testimonial-card")).toBeInTheDocument();
  });

  it("renders the quote text in a blockquote", () => {
    const { container } = render(
      <TestimonialCard quote="Changed my career!" studentName="Priya K." />,
    );
    expect(container.querySelector("blockquote")).toBeInTheDocument();
    expect(screen.getByText(/Changed my career!/)).toBeInTheDocument();
  });

  it("renders student name in cite element", () => {
    const { container } = render(
      <TestimonialCard quote="Q" studentName="Rahul S." />,
    );
    const cite = container.querySelector("cite");
    expect(cite).toBeInTheDocument();
    expect(cite?.textContent).toContain("Rahul S.");
  });

  it("renders college and program", () => {
    render(
      <TestimonialCard
        quote="Q"
        studentName="A"
        college="NIT Warangal"
        program="Python DS"
      />,
    );
    // College appears twice by design: once as the "logo slot", once in the
    // footer caption alongside the program (mirrors a company logo + title line).
    expect(screen.getAllByText(/NIT Warangal/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Python DS/)).toBeInTheDocument();
  });

  it("does not render a logo slot when college is not provided", () => {
    render(<TestimonialCard quote="Q" studentName="A" program="Python DS" />);
    expect(screen.queryByText(/NIT Warangal/)).not.toBeInTheDocument();
  });

  it("does not render a CTA pill when href is not provided", () => {
    render(<TestimonialCard quote="Q" studentName="A" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a CTA pill linking to href when provided", () => {
    render(<TestimonialCard quote="Q" studentName="A" href="/testimonials" ctaLabel="Read full story" />);
    const link = screen.getByRole("link", { name: "Read full story" });
    expect(link).toHaveAttribute("href", "/testimonials");
  });

  it("renders avatar initials fallback when no avatarSrc", () => {
    render(<TestimonialCard quote="Q" studentName="Aditya" />);
    // The initial "A" appears in the fallback avatar div
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders avatar img with aria-hidden when src provided", () => {
    const { container } = render(
      <TestimonialCard quote="Q" studentName="A" avatarSrc="/avatar.jpg" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("renders star rating with aria-label", () => {
    render(<TestimonialCard quote="Q" studentName="A" ratingStars={5} />);
    expect(screen.getByLabelText("Rated 5 out of 5 stars")).toBeInTheDocument();
  });

  it("does not render stars when ratingStars is not provided", () => {
    render(<TestimonialCard quote="Q" studentName="A" />);
    expect(screen.queryByLabelText(/rated/i)).not.toBeInTheDocument();
  });

  it("renders video slot when provided", () => {
    render(
      <TestimonialCard
        quote="Q"
        studentName="A"
        videoSlot={<video data-testid="yt-video" />}
      />,
    );
    expect(screen.getByTestId("yt-video")).toBeInTheDocument();
  });
});

describe("TestimonialCard, a11y", () => {
  it("uses an <article> element", () => {
    const { container } = render(
      <TestimonialCard quote="Q" studentName="A" />,
    );
    expect(container.querySelector("article")).toBeInTheDocument();
  });

  it("rating is never color-only, aria-label conveys the value", () => {
    render(<TestimonialCard quote="Q" studentName="A" ratingStars={4} />);
    // The text "4" is not the sole indicator, aria-label carries the full description
    expect(screen.getByLabelText("Rated 4 out of 5 stars")).toBeInTheDocument();
  });
});
