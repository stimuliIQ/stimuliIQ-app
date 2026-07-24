/**
 * CoursesSidebar component tests.
 *
 * Verifies:
 *   - role=search landmark and data-testid (a11y / QA automation: AC-40)
 *   - Search input, specialisation checkboxes, and sort select are labelled
 *   - Single-select checkbox semantics reflect the current domain
 *   - Result count live region renders (a11y: AC-40)
 *
 * Note: useRouter / useSearchParams are mocked; this tests the component UI,
 * not the Next.js routing behavior.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation before importing the component
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({
    toString: () => "",
  }),
}));

import { CoursesSidebar } from "./courses-sidebar";

const DOMAINS = [
  { value: "Python", label: "Python" },
  { value: "Cloud", label: "Cloud Computing" },
];

describe("CoursesSidebar", () => {
  it("renders with data-testid for QA automation", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} />);
    expect(screen.getByTestId("courses-sidebar")).toBeInTheDocument();
  });

  it("renders the role=search container (a11y landmark)", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} />);
    expect(
      screen.getByRole("search", { name: /filter and sort courses/i }),
    ).toBeInTheDocument();
  });

  it("has a labelled search input", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} />);
    expect(screen.getByLabelText("Search course name")).toBeInTheDocument();
  });

  it("checks All Courses when no domain filter is active", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} />);
    const all = screen.getByLabelText("All Courses") as HTMLInputElement;
    expect(all.checked).toBe(true);
  });

  it("checks only the active domain (single-select semantics)", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{ domain: "Python" }} />);
    const all = screen.getByLabelText("All Courses") as HTMLInputElement;
    const python = screen.getByLabelText("Filter by Python") as HTMLInputElement;
    const cloud = screen.getByLabelText("Filter by Cloud Computing") as HTMLInputElement;
    expect(all.checked).toBe(false);
    expect(python.checked).toBe(true);
    expect(cloud.checked).toBe(false);
  });

  it("has a labelled sort select reflecting the current sort", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{ sort: "price_asc" }} />);
    const select = screen.getByLabelText("Sort courses") as HTMLSelectElement;
    expect(select.value).toBe("price_asc");
  });

  it("seeds the search input from the current query", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{ q: "react" }} />);
    const input = screen.getByLabelText("Search course name") as HTMLInputElement;
    expect(input.value).toBe("react");
  });

  it("renders result count in a SR live region when totalCount is provided", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} totalCount={12} />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toContain("12");
  });

  it("uses singular 'course' when count is 1", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} totalCount={1} />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toContain("1 course found");
  });

  it("omits the live region when totalCount is undefined", () => {
    render(<CoursesSidebar domains={DOMAINS} current={{}} />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeNull();
  });
});
