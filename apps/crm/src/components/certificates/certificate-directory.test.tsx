// Tests for the certificate ID on the eligibility table.
//
// The row used to say only "Issued", which answers "does this student have a certificate?"
// but not "which one?" — the question somebody is actually holding when a student rings up
// quoting a number off a printed page.
//
// A certificate carries THREE identifiers and only one of them belongs on screen:
// `certificateId` is a database uuid nobody quotes, `certUid` is the long HMAC-signed string
// behind the QR link, and `serial` (STMQ-YYYY-XXXX-XXXX) is the short one built to be read
// aloud and typed into the verify form. These tests pin that the serial is what shows, and
// that it stays visible on a revoked row — which is exactly when somebody is asking.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse } from "@repo/types";

const SERIAL = "STMQ-2026-SNEH-0001";

let rows: unknown[];

// Partial mock via importOriginal: this component reaches for a dozen hooks and only the
// list one matters here. Enumerating them by hand meant the mock broke the moment the
// component grew another, with an error about a missing export rather than anything to do
// with what is under test.
vi.mock("../../hooks/use-certificates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-certificates")>();
  const noopMutation = () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false });
  return {
    ...actual,
    useEligibilityList: () => ({
      data: { items: rows, meta: { page: 1, pageSize: 20, total: rows.length, hasMore: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useEligibilityDetail: () => ({ data: undefined, isLoading: false, isError: false }),
    useEligibilityBatches: () => ({ data: { items: [] }, isLoading: false, isError: false }),
    useCertificateTemplates: () => ({ data: { items: [] }, isLoading: false, isError: false }),
    useIssueCertificate: noopMutation,
    useRevokeCertificate: noopMutation,
    useRecommendCertificate: noopMutation,
    useReissueCertificate: noopMutation,
    useBulkIssueCertificates: noopMutation,
  };
});

import { CertificateDirectory } from "./certificate-directory";

function row(over: Record<string, unknown> = {}) {
  return {
    enrollmentId: "11111111-1111-4111-8111-111111111111",
    studentId: "22222222-2222-4222-8222-222222222222",
    studentName: "Sneha Iyer",
    programId: "33333333-3333-4333-8333-333333333333",
    programTitle: "Data Science & Machine Learning Internship",
    batchId: "44444444-4444-4444-8444-444444444444",
    batchName: "Batch BLR-01",
    eligibility: {
      eligible: true,
      reasons: {
        completionPassed: true,
        completionPct: 100,
        requiredAssessmentsPassed: true,
        finalProjectPassed: true,
      },
    },
    certificateStatus: "valid",
    certificateId: "55555555-5555-4555-8555-555555555555",
    certUid: "a-very-long-signed-uid-nobody-can-read",
    serial: SERIAL,
    issuedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

const ME = {
  permissions: [
    { key: "certificates.view", scope: "all" },
    { key: "certificates.issue", scope: "all" },
    { key: "certificates.revoke", scope: "all" },
  ],
} as unknown as MeResponse;

function renderDirectory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CertificateDirectory me={ME} batchId="44444444-4444-4444-8444-444444444444" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rows = [row()];
  // jsdom defines navigator.clipboard as a getter-only property, so it has to be redefined
  // rather than assigned.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe("CertificateDirectory, the certificate ID", () => {
  it("shows the serial beside the Issued chip", () => {
    renderDirectory();

    expect(screen.getByText("Issued")).toBeInTheDocument();
    expect(screen.getByText(SERIAL)).toBeInTheDocument();
  });

  it("shows the SERIAL, never the internal uuid or the signed uid", () => {
    // Those two identify the row to the database and to the QR link. Neither is something a
    // person can read off a certificate, and putting them on screen invites somebody to
    // quote one down a phone.
    renderDirectory();

    expect(screen.queryByText("55555555-5555-4555-8555-555555555555")).not.toBeInTheDocument();
    expect(screen.queryByText("a-very-long-signed-uid-nobody-can-read")).not.toBeInTheDocument();
  });

  it("keeps the ID visible on a REVOKED certificate", () => {
    // "Which certificate was revoked?" is precisely the question being asked at that moment.
    rows = [row({ certificateStatus: "revoked" })];

    renderDirectory();

    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText(SERIAL)).toBeInTheDocument();
  });

  it("shows nothing but 'Not issued' when there is no certificate", () => {
    rows = [row({ certificateStatus: null, serial: null, certificateId: null, certUid: null })];

    renderDirectory();

    expect(screen.getByText("Not issued")).toBeInTheDocument();
    expect(screen.queryByText(SERIAL)).not.toBeInTheDocument();
  });

  it("copies the ID to the clipboard on click", async () => {
    // An identifier you cannot get out of the screen is barely an identifier.
    const user = userEvent.setup();
    renderDirectory();

    await user.click(screen.getByTestId(`certificate-serial-${SERIAL}`));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SERIAL);
  });

  it("exposes the ID as a real control, so it is reachable by keyboard", () => {
    renderDirectory();

    const control = screen.getByRole("button", { name: `Copy certificate ID ${SERIAL}` });
    expect(control).toBeInTheDocument();
  });
});
