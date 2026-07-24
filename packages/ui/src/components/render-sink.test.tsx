import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RenderSink } from "./render-sink";

describe("RenderSink", () => {
  it("renders sanitized HTML content", () => {
    render(<RenderSink html="<p>Hello <strong>world</strong></p>" />);
    const sink = screen.getByTestId("render-sink");
    expect(sink.innerHTML).toContain("<strong>world</strong>");
  });

  it("strips <script> tags by default (sink-level XSS control)", () => {
    render(<RenderSink html="<p>Safe</p><script>alert('xss')</script>" />);
    const sink = screen.getByTestId("render-sink");
    expect(sink.innerHTML).not.toContain("<script");
    expect(sink.innerHTML).not.toContain("alert(");
  });

  it("strips inline event handler attributes", () => {
    render(<RenderSink html='<img src="x.png" onerror="alert(1)" alt="x" />' />);
    const sink = screen.getByTestId("render-sink");
    expect(sink.innerHTML).not.toContain("onerror");
  });

  it("strips javascript: URIs from links", () => {
    render(<RenderSink html={'<a href="javascript:alert(1)">click</a>'} />);
    const sink = screen.getByTestId("render-sink");
    expect(sink.innerHTML).not.toContain("javascript:");
  });

  it("strips images when allowImages is false", () => {
    render(
      <RenderSink
        html='<p>Body</p><img src="a.png" alt="a" />'
        sanitizeOptions={{ allowImages: false }}
      />,
    );
    const sink = screen.getByTestId("render-sink");
    expect(sink.querySelector("img")).toBeNull();
  });

  it("renders trustedHtml verbatim without re-sanitizing (still no script since caller pre-sanitized)", () => {
    render(<RenderSink html="<p>Pre-sanitized</p>" trustedHtml />);
    expect(screen.getByText("Pre-sanitized")).toBeInTheDocument();
  });

  it("shows loading skeleton when loading", () => {
    render(<RenderSink html={null} loading />);
    const sink = screen.getByTestId("render-sink");
    expect(sink).toHaveAttribute("aria-busy", "true");
  });

  it("shows EmptyState when html is empty", () => {
    render(<RenderSink html="" emptyTitle="No article yet" />);
    expect(screen.getByText("No article yet")).toBeInTheDocument();
  });

  it("shows EmptyState when html is null", () => {
    render(<RenderSink html={null} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("supports a custom data-testid", () => {
    render(<RenderSink html="<p>x</p>" data-testid="kb-article-body" />);
    expect(screen.getByTestId("kb-article-body")).toBeInTheDocument();
  });
});
