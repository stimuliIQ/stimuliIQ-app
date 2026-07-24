import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StarRatingInput, TestimonialInput, type TestimonialFormValues } from "./testimonial-input";

describe("StarRatingInput", () => {
  it("renders a radiogroup with an accessible name describing the current rating", () => {
    render(<StarRatingInput value={3} onChange={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: "Rating: 3 out of 5 stars" })).toBeInTheDocument();
  });

  it("renders 5 stars as radio buttons by default", () => {
    render(<StarRatingInput value={0} onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("marks the selected star as checked", () => {
    render(<StarRatingInput value={3} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "3 stars" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "4 stars" })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange when a star is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StarRatingInput value={0} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "4 stars" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("moves and selects via ArrowRight from the roving-focus star", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StarRatingInput value={2} onChange={onChange} />);
    screen.getByRole("radio", { name: "2 stars" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("only the current-rating star has tabIndex 0", () => {
    render(<StarRatingInput value={2} onChange={vi.fn()} />);
    const radios = screen.getAllByRole("radio");
    const zeroTabIndex = radios.filter((r) => r.getAttribute("tabindex") === "0");
    expect(zeroTabIndex).toHaveLength(1);
    expect(zeroTabIndex[0]).toHaveAccessibleName("2 stars");
  });
});

describe("TestimonialInput", () => {
  const baseValue: TestimonialFormValues = {
    quote: "",
    ratingStars: 0,
    studentName: "",
  };

  it("renders the rating, quote, and name fields", () => {
    render(<TestimonialInput value={baseValue} onChange={vi.fn()} />);
    expect(screen.getByTestId("testimonial-input-rating")).toBeInTheDocument();
    expect(screen.getByTestId("testimonial-input-quote")).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument();
  });

  it("calls onChange when the quote text is edited", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestimonialInput value={baseValue} onChange={onChange} />);
    await user.type(screen.getByTestId("testimonial-input-quote"), "G");
    expect(onChange).toHaveBeenCalledWith({ ...baseValue, quote: "G" });
  });

  it("calls onSubmit with the current value on submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const filled: TestimonialFormValues = {
      quote: "Great program!",
      ratingStars: 5,
      studentName: "Aditi",
    };
    render(<TestimonialInput value={filled} onChange={vi.fn()} onSubmit={onSubmit} />);
    await user.click(screen.getByTestId("testimonial-input-submit"));
    expect(onSubmit).toHaveBeenCalledWith(filled);
  });

  it("shows a field-level error", () => {
    render(
      <TestimonialInput value={baseValue} onChange={vi.fn()} errors={{ quote: "Review is required" }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Review is required");
  });

  it("does not render a submit button when onSubmit is not provided", () => {
    render(<TestimonialInput value={baseValue} onChange={vi.fn()} />);
    expect(screen.queryByTestId("testimonial-input-submit")).not.toBeInTheDocument();
  });
});
