import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders as a presentational, screen-reader-hidden placeholder", () => {
    render(<Skeleton data-testid="skeleton-block" />);
    const el = screen.getByTestId("skeleton-block");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("role", "presentation");
  });

  it("supports line/circle shapes", () => {
    render(<Skeleton shape="circle" data-testid="skeleton-circle" />);
    expect(screen.getByTestId("skeleton-circle")).toHaveClass("rounded-full");
  });
});
