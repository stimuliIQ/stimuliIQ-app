import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CampaignMetricsCard } from "./campaign-metrics-card";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("CampaignMetricsCard, rendering", () => {
  it("renders with default data-testid='campaign-metrics-card'", () => {
    render(<CampaignMetricsCard totalRecipients={500} sent={492} />);
    expect(screen.getByTestId("campaign-metrics-card")).toBeInTheDocument();
  });

  it("renders 'Sent' metric", () => {
    render(<CampaignMetricsCard totalRecipients={500} sent={492} />);
    expect(screen.getByLabelText(/sent: 492/i)).toBeInTheDocument();
  });

  it("renders 'Delivered' metric with rate", () => {
    render(
      <CampaignMetricsCard totalRecipients={500} sent={492} delivered={480} />,
    );
    expect(screen.getByLabelText(/delivered: 480/i)).toBeInTheDocument();
  });

  it("renders 'Opened / Read' metric", () => {
    render(
      <CampaignMetricsCard totalRecipients={500} sent={492} delivered={480} opened={240} />,
    );
    expect(screen.getByLabelText(/opened \/ read: 240/i)).toBeInTheDocument();
  });

  it("renders 'Failed' metric", () => {
    render(<CampaignMetricsCard totalRecipients={500} sent={492} failed={8} />);
    expect(screen.getByLabelText(/failed: 8/i)).toBeInTheDocument();
  });

  it("renders campaign name as heading when provided", () => {
    render(
      <CampaignMetricsCard
        totalRecipients={100}
        sent={100}
        campaignName="Summer 2025 Mailer"
      />,
    );
    expect(screen.getByRole("heading", { name: "Summer 2025 Mailer" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading + error states
// ---------------------------------------------------------------------------

describe("CampaignMetricsCard, states", () => {
  it("renders with aria-busy=true when loading", () => {
    render(<CampaignMetricsCard loading />);
    expect(screen.getByTestId("campaign-metrics-card")).toHaveAttribute("aria-busy", "true");
  });

  it("renders error message with role=alert when error is provided", () => {
    render(<CampaignMetricsCard error="Failed to load metrics." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load metrics.");
  });
});

// ---------------------------------------------------------------------------
// a11y, no color-only status
// ---------------------------------------------------------------------------

describe("CampaignMetricsCard, a11y", () => {
  it("each metric has an aria-label conveying both number and label", () => {
    render(
      <CampaignMetricsCard
        totalRecipients={100}
        sent={95}
        delivered={90}
        opened={50}
        failed={5}
      />,
    );
    // spot check three
    expect(screen.getByLabelText(/sent: 95/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/delivered: 90/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/failed: 5/i)).toBeInTheDocument();
  });

  it("metric icons are aria-hidden", () => {
    const { container } = render(<CampaignMetricsCard totalRecipients={100} sent={95} />);
    // All SVGs within metric cells should be aria-hidden
    container.querySelectorAll("svg").forEach((svg) => {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });
  });
});
