// VerifyPanel component tests
// Covers three states (valid / revoked / invalid) + a11y checks.
// (docs/plans/phase-4.md task #11 DoD: "component/route test ... cover valid / revoked / invalid states")
//
// Runs with vitest + jsdom (same setup as @repo/ui).
//
// A11y assertions:
//   - Status is conveyed by both icon AND text (not color-only) for each state.
//   - Semantic role="region" with aria-label on all state panels.
//   - role="status" on the status badge (aria-live polite / assertive for screen readers).
//   - Verify certId shown in invalid state for user to cross-check.
//   - data-testid coverage for QA automation.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { VerifyPanel } from "./verify-panel";
import type { VerifyState } from "./verify-panel";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATE: VerifyState = {
  kind: "valid",
  result: {
    valid: true,
    status: "valid",
    program: "Full Stack Development Internship",
    issuedAt: "2025-12-01T00:00:00.000Z",
    holderName: "Aditi Sharma",
  },
};

const REVOKED_STATE: VerifyState = {
  kind: "revoked",
  result: {
    valid: "revoked",
    status: "revoked",
    program: "Data Science Bootcamp",
    issuedAt: "2025-06-15T00:00:00.000Z",
    holderName: "Rahul Gupta",
  },
};

const INVALID_STATE: VerifyState = {
  kind: "invalid",
};

const CERT_ID = "CERT-test-uid-abc123";

// ─────────────────────────────────────────────────────────────────────────────
// Valid state tests
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyPanel — valid state", () => {
  it("renders the verify-panel-valid testid", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-panel-valid")).toBeInTheDocument();
  });

  it("shows 'Certificate Verified' status label (text, not color-only — a11y)", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-status-label")).toHaveTextContent("Certificate Verified");
  });

  it("renders the program name", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-program")).toHaveTextContent(
      "Full Stack Development Internship",
    );
  });

  it("renders the holder name (the only PII field — AC-H7)", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-holder")).toHaveTextContent("Aditi Sharma");
  });

  it("renders the issued-at date", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    // Check that the date field exists and is non-empty
    const dateEl = screen.getByTestId("verify-issued-at");
    expect(dateEl.textContent).toBeTruthy();
    expect(dateEl.textContent).toMatch(/2025/);
  });

  it("status badge has role=status (SR announcement) and aria-label mentioning Valid (a11y)", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    const region = screen.getByRole("region", { name: /valid/i });
    expect(region).toBeInTheDocument();
    // role=status must exist inside the region (aria-live polite for SR)
    const statusEl = region.querySelector('[role="status"]');
    expect(statusEl).not.toBeNull();
  });

  it("does not render revoked or invalid panels", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    expect(screen.queryByTestId("verify-panel-revoked")).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-panel-invalid")).not.toBeInTheDocument();
  });

  it("does NOT contain enrollmentId, studentId, email, or phone (AC-H7 compile + runtime)", () => {
    const { container } = render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    const html = container.innerHTML;
    // None of the banned PII fields should appear in the rendered HTML
    expect(html).not.toMatch(/enrollmentId|enrollment_id/i);
    expect(html).not.toMatch(/studentId|student_id/i);
    expect(html).not.toMatch(/@|\.com/); // no email-like strings
  });

  it("shows the Certificate ID when the visitor arrived by typing a serial", () => {
    // certId IS the short serial the visitor typed → surface it as the human ID.
    render(<VerifyPanel state={VALID_STATE} certId="STMQ-2026-7F3K-9QX2" />);
    expect(screen.getByTestId("verify-serial")).toHaveTextContent("STMQ-2026-7F3K-9QX2");
  });

  it("omits the Certificate ID row when arriving via a long cert_uid (QR/link)", () => {
    // A long signed cert_uid is not a serial → no short ID to show.
    render(<VerifyPanel state={VALID_STATE} certId="eyJzIjoiYWJjIn0.k9Xr2mQ7vB" />);
    expect(screen.queryByTestId("verify-serial")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Revoked state tests
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyPanel — revoked state", () => {
  it("renders the verify-panel-revoked testid", () => {
    render(<VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-panel-revoked")).toBeInTheDocument();
  });

  it("shows 'Certificate Revoked' status label (text — not color-only — a11y)", () => {
    render(<VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-status-label")).toHaveTextContent("Certificate Revoked");
  });

  it("renders the program name for context", () => {
    render(<VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-program")).toHaveTextContent("Data Science Bootcamp");
  });

  it("renders the holder name for context (AC-H2 — minimal info still shown)", () => {
    render(<VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-holder")).toHaveTextContent("Rahul Gupta");
  });

  it("status badge has role=region with aria-label mentioning Revoked (a11y)", () => {
    render(<VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />);
    const region = screen.getByRole("region", { name: /revoked/i });
    expect(region).toBeInTheDocument();
  });

  it("icon in revoked panel uses a distinct shape (ShieldX vs ShieldCheck for valid)", () => {
    const { container: revokedContainer } = render(
      <VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />,
    );
    const { container: validContainer } = render(
      <VerifyPanel state={VALID_STATE} certId={CERT_ID} />,
    );
    // The rendered SVG path data should differ between ShieldX and ShieldCheck
    const revokedSvg = revokedContainer.querySelector('[data-testid="verify-panel-revoked"] svg');
    const validSvg = validContainer.querySelector('[data-testid="verify-panel-valid"] svg');
    expect(revokedSvg?.innerHTML).not.toEqual(validSvg?.innerHTML);
  });

  it("does not render valid or invalid panels", () => {
    render(<VerifyPanel state={REVOKED_STATE} certId={CERT_ID} />);
    expect(screen.queryByTestId("verify-panel-valid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-panel-invalid")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid state tests (fabricated / tampered / not-found certId — AC-H3/H4/H5)
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyPanel — invalid state", () => {
  it("renders the verify-panel-invalid testid", () => {
    render(<VerifyPanel state={INVALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-panel-invalid")).toBeInTheDocument();
  });

  it("shows 'Certificate Not Found' status label", () => {
    render(<VerifyPanel state={INVALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-status-label")).toHaveTextContent("Certificate Not Found");
  });

  it("displays the attempted certId for user cross-check (no internal details)", () => {
    render(<VerifyPanel state={INVALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-attempted-id")).toHaveTextContent(CERT_ID);
  });

  it("does NOT contain program, holder, or date fields (no data to show for invalid)", () => {
    render(<VerifyPanel state={INVALID_STATE} certId={CERT_ID} />);
    expect(screen.queryByTestId("verify-program")).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-holder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-issued-at")).not.toBeInTheDocument();
  });

  it("status badge has role=region with aria-label mentioning Not found (a11y)", () => {
    render(<VerifyPanel state={INVALID_STATE} certId={CERT_ID} />);
    const region = screen.getByRole("region", { name: /not found/i });
    expect(region).toBeInTheDocument();
  });

  it("does NOT contain server-internal details (stack traces, DB errors)", () => {
    const { container } = render(
      <VerifyPanel state={INVALID_STATE} certId={CERT_ID} />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/stack|Error:|prisma|database|500|Internal/i);
  });

  it("does not render valid or revoked panels", () => {
    render(<VerifyPanel state={INVALID_STATE} certId={CERT_ID} />);
    expect(screen.queryByTestId("verify-panel-valid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("verify-panel-revoked")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Root wrapper tests
// ─────────────────────────────────────────────────────────────────────────────

describe("VerifyPanel — root element", () => {
  it("renders the custom data-testid if provided", () => {
    render(
      <VerifyPanel state={VALID_STATE} certId={CERT_ID} data-testid="custom-verify-panel" />,
    );
    expect(screen.getByTestId("custom-verify-panel")).toBeInTheDocument();
  });

  it("defaults to data-testid=verify-panel when none is provided", () => {
    render(<VerifyPanel state={VALID_STATE} certId={CERT_ID} />);
    expect(screen.getByTestId("verify-panel")).toBeInTheDocument();
  });
});
