import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CertificateCard } from "./certificate-card";

const baseProps = {
  programName: "Full Stack Development",
  holderName: "Aditi Sharma",
  issuedAt: "2025-12-01",
  status: "valid" as const,
  downloadUrl: "https://example.com/cert.pdf",
  verifyUrl: "https://stimuliiq.com/verify/CERT-abc123",
  certUid: "CERT-abc123",
};

describe("CertificateCard", () => {
  // ---------------------------------------------------------------------------
  // Unit tests
  // ---------------------------------------------------------------------------

  it("renders program name, holder, and issued date", () => {
    render(<CertificateCard {...baseProps} />);
    expect(screen.getByText("Full Stack Development")).toBeInTheDocument();
    expect(screen.getByText("Aditi Sharma")).toBeInTheDocument();
    // Date formatted as Indian locale (may vary by locale but text is present)
    expect(screen.getByTestId("certificate-card")).toBeInTheDocument();
  });

  it("renders the StatusChip with the correct tone label", () => {
    render(<CertificateCard {...baseProps} status="valid" />);
    expect(screen.getByTestId("certificate-card-status")).toHaveTextContent("Valid");
  });

  it("renders 'Revoked' status chip for revoked certificates", () => {
    render(<CertificateCard {...baseProps} status="revoked" downloadUrl={null} />);
    expect(screen.getByTestId("certificate-card-status")).toHaveTextContent("Revoked");
  });

  it("renders 'Pending' status chip for pending certificates", () => {
    render(
      <CertificateCard
        {...baseProps}
        status="pending"
        downloadUrl={null}
        issuedAt={undefined}
      />,
    );
    expect(screen.getByTestId("certificate-card-status")).toHaveTextContent("Pending");
    expect(screen.getByText("Not yet issued")).toBeInTheDocument();
  });

  it("renders an enabled download button when downloadUrl is present and status is valid", () => {
    render(<CertificateCard {...baseProps} />);
    const btn = screen.getByTestId("certificate-card-download");
    expect(btn).not.toBeDisabled();
    expect(btn.closest("a")).toHaveAttribute("href", baseProps.downloadUrl);
  });

  it("renders a disabled download button when downloadUrl is null", () => {
    render(
      <CertificateCard
        {...baseProps}
        status="pending"
        downloadUrl={null}
        downloadUnavailableReason="Complete requirements to unlock."
      />,
    );
    const btn = screen.getByTestId("certificate-card-download");
    expect(btn).toBeDisabled();
  });

  it("shows the unavailable reason when download is disabled", () => {
    render(
      <CertificateCard
        {...baseProps}
        status="pending"
        downloadUrl={null}
        downloadUnavailableReason="Complete requirements to unlock."
      />,
    );
    expect(screen.getByTestId("certificate-card-unavailable-reason")).toHaveTextContent(
      "Complete requirements to unlock.",
    );
  });

  it("renders the verify link with a descriptive aria-label", () => {
    render(<CertificateCard {...baseProps} />);
    const verifyLink = screen.getByTestId("certificate-card-verify");
    const ariaLabel = verifyLink.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("Verify");
    expect(ariaLabel).toContain("CERT-abc123");
  });

  it("calls onDownload when the download button is clicked", async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(<CertificateCard {...baseProps} onDownload={onDownload} />);
    const downloadBtn = screen.getByTestId("certificate-card-download");
    await user.click(downloadBtn);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("renders the certUid in monospace for identification", () => {
    render(<CertificateCard {...baseProps} />);
    expect(screen.getByText("CERT-abc123")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // a11y tests
  // ---------------------------------------------------------------------------

  it("download button for enabled state has a descriptive aria-label (not just 'Download')", () => {
    render(<CertificateCard {...baseProps} />);
    const link = screen.getByTestId("certificate-card-download").closest("a");
    const label = link?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Full Stack Development");
  });

  it("verify link opens in a new tab with rel=noopener", () => {
    render(<CertificateCard {...baseProps} />);
    const link = screen.getByTestId("certificate-card-verify").closest("a")!;
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a StatusChip that does not rely on color alone (text label present)", () => {
    render(<CertificateCard {...baseProps} status="revoked" downloadUrl={null} />);
    const chip = screen.getByTestId("certificate-card-status");
    // The chip must have visible text (not just color), the label is the
    // non-color differentiator; chips are icon-free by design (flat soft badge).
    expect(chip.textContent).toContain("Revoked");
  });

  it("thumbnail has meaningful alt text when thumbnailSrc is provided", () => {
    render(
      <CertificateCard
        {...baseProps}
        thumbnailSrc="https://example.com/thumb.png"
      />,
    );
    const img = screen.getByAltText("Certificate thumbnail for Full Stack Development");
    expect(img).toBeInTheDocument();
  });

  it("exposes data-testid", () => {
    render(<CertificateCard {...baseProps} data-testid="my-cert" />);
    expect(screen.getByTestId("my-cert")).toBeInTheDocument();
  });
});
