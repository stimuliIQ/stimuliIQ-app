import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarketingFooter, type FooterColumn } from "./marketing-footer";

const columns: FooterColumn[] = [
  { heading: "Programs", links: [{ label: "Python", href: "/programs/python" }] },
  { heading: "Company", links: [{ label: "About", href: "/about" }] },
];

describe("MarketingFooter, rendering", () => {
  it("renders with default data-testid='marketing-footer'", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
      />,
    );
    expect(screen.getByTestId("marketing-footer")).toBeInTheDocument();
  });

  it("renders column headings", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
      />,
    );
    expect(screen.getByText("Programs")).toBeInTheDocument();
    expect(screen.getByText("Company")).toBeInTheDocument();
  });

  it("renders column links", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
      />,
    );
    expect(screen.getByRole("link", { name: "Python" })).toHaveAttribute("href", "/programs/python");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it("renders legal links when provided", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        legalLinks={[{ label: "Privacy Policy", href: "/privacy" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeInTheDocument();
  });

  it("renders the cert verify link when provided", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        certVerifyHref="/verify"
      />,
    );
    expect(screen.getByRole("link", { name: "Verify Certificate" })).toHaveAttribute("href", "/verify");
  });

  it("renders copyright text", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        copyrightText="© 2026 StimuliiQ"
      />,
    );
    expect(screen.getByText("© 2026 StimuliiQ")).toBeInTheDocument();
  });

  it("renders social links with aria-labels", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        socialLinks={[
          { label: "LinkedIn", href: "https://linkedin.com", icon: <span>LI</span> },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "LinkedIn" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("target", "_blank");
  });

  it("renders newsletter slot when provided", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        newsletterSlot={<input placeholder="newsletter-input" />}
      />,
    );
    expect(screen.getByPlaceholderText("newsletter-input")).toBeInTheDocument();
  });
});

describe("MarketingFooter, a11y", () => {
  it("has footer landmark", () => {
    const { container } = render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
      />,
    );
    expect(container.querySelector("footer")).toBeInTheDocument();
  });

  it("has legal links nav with aria-label", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        legalLinks={[{ label: "Privacy", href: "/privacy" }]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Legal links" })).toBeInTheDocument();
  });

  it("has social links nav with aria-label", () => {
    render(
      <MarketingFooter
        logo={<img src="/logo.svg" alt="StimuliiQ" />}
        columns={columns}
        socialLinks={[{ label: "Twitter", href: "https://twitter.com", icon: <span /> }]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Social media links" })).toBeInTheDocument();
  });
});
