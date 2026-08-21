import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Breadcrumbs, buildBreadcrumbJsonLd, type BreadcrumbItem } from "./breadcrumbs";

const items: BreadcrumbItem[] = [
  { label: "Home", href: "/" },
  { label: "Programs", href: "/programs" },
  { label: "Python for Data Science" },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("Breadcrumbs, rendering", () => {
  it("renders with default data-testid='breadcrumbs'", () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByTestId("breadcrumbs")).toBeInTheDocument();
  });

  it("renders links for non-current items", () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Programs" })).toHaveAttribute("href", "/programs");
  });

  it("renders last item without a link", () => {
    render(<Breadcrumbs items={items} />);
    // The last item is a span, not an <a>
    expect(screen.queryByRole("link", { name: "Python for Data Science" })).not.toBeInTheDocument();
    expect(screen.getByText("Python for Data Science")).toBeInTheDocument();
  });

  it("marks last item with aria-current='page'", () => {
    render(<Breadcrumbs items={items} />);
    const current = screen.getByText("Python for Data Science");
    expect(current).toHaveAttribute("aria-current", "page");
  });
});

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

describe("Breadcrumbs, a11y", () => {
  it("renders inside a <nav> with aria-label='Breadcrumb'", () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("renders an ordered list with role='list'", () => {
    const { container } = render(<Breadcrumbs items={items} />);
    const ol = container.querySelector("ol[role='list']");
    expect(ol).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

describe("buildBreadcrumbJsonLd", () => {
  it("produces valid BreadcrumbList JSON", () => {
    const json = buildBreadcrumbJsonLd(items, "https://example.com");
    const parsed = JSON.parse(json);
    expect(parsed["@type"]).toBe("BreadcrumbList");
    expect(parsed.itemListElement).toHaveLength(3);
    expect(parsed.itemListElement[0].position).toBe(1);
    expect(parsed.itemListElement[0].name).toBe("Home");
    expect(parsed.itemListElement[0].item).toBe("https://example.com/");
    // Last item has no href
    expect(parsed.itemListElement[2].item).toBeUndefined();
  });

  it("escapes </script> in the output", () => {
    const json = buildBreadcrumbJsonLd([
      { label: "</script><script>alert(1)</script>", href: "/evil" },
    ]);
    expect(json).not.toContain("</script>");
    expect(json).toContain("<\\/script>");
  });
});
