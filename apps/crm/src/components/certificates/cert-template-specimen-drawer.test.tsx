// The certificate preview replaced a "template designer" that showed a layout unrelated to
// the certificate students actually receive. What matters here is that the replacement does
// not repeat that: it must show the real rendered document, and it must say plainly that
// the values on it are placeholders and that nothing was issued. A preview somebody
// mistakes for a real award is the failure mode worth guarding.
import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CertTemplateSpecimenDrawer } from "./cert-template-specimen-drawer";

// Radix's Select is driven by pointer events jsdom does not implement, and picking a
// template is the only way into every state below. Swap ONLY Select/SelectItem for native
// equivalents (the established pattern, see assessment-form-drawer.test.tsx).
vi.mock("@repo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/ui")>();
  return {
    ...actual,
    Select: ({
      label,
      value,
      onValueChange,
      children,
      placeholder,
      "data-testid": testId,
    }: {
      label?: string;
      value?: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      placeholder?: string;
      "data-testid"?: string;
    }) => (
      <label>
        {label}
        <select data-testid={testId} value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
          <option value="">{placeholder}</option>
          {children}
        </select>
      </label>
    ),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const useCertificateTemplatesMock = vi.fn();
const useCertificateTemplateSpecimenMock = vi.fn();

vi.mock("../../hooks/use-certificates", () => ({
  useCertificateTemplates: (...args: unknown[]) => useCertificateTemplatesMock(...args),
  useCertificateTemplateSpecimen: (...args: unknown[]) => useCertificateTemplateSpecimenMock(...args),
}));

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

const SPECIMEN = {
  contentType: "application/pdf" as const,
  // Tiny stand-in for the ~1.4 MB real render; only the blob plumbing is under test.
  bytesBase64: "JVBERi0xLjQK",
  templateName: "Internship completion",
  certificateKind: "internship" as const,
  sample: {
    holderName: "Sample Student",
    programName: "Sample Programme",
    certificateId: "SPECIMEN-NOT-A-REAL-CERTIFICATE",
    issuedAt: "2026-09-05T00:00:00.000Z",
  },
};

function specimenState(over: Record<string, unknown> = {}) {
  return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over };
}

beforeEach(() => {
  useCertificateTemplatesMock.mockReset();
  useCertificateTemplateSpecimenMock.mockReset();
  useCertificateTemplatesMock.mockReturnValue({
    data: { items: [{ id: TEMPLATE_ID, name: "Internship completion", status: "active", createdAt: "2026-01-01T00:00:00.000Z" }] },
  });
  useCertificateTemplateSpecimenMock.mockReturnValue(specimenState());
  // jsdom implements neither of these; the drawer turns base64 into a blob URL for the frame.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:specimen"), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CertTemplateSpecimenDrawer", () => {
  it("asks for a template before rendering anything", () => {
    render(<CertTemplateSpecimenDrawer open onOpenChange={() => {}} />);
    expect(screen.getByTestId("cert-specimen-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("cert-specimen-frame")).not.toBeInTheDocument();
  });

  it("does not fetch a 1.4 MB render for a drawer that is closed", () => {
    render(<CertTemplateSpecimenDrawer open={false} onOpenChange={() => {}} />);
    expect(useCertificateTemplateSpecimenMock).toHaveBeenCalledWith(null);
  });

  it("frames the rendered PDF once a template is chosen", async () => {
    const user = userEvent.setup();
    useCertificateTemplateSpecimenMock.mockReturnValue(specimenState({ data: SPECIMEN }));

    render(<CertTemplateSpecimenDrawer open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByTestId("cert-template-select"), TEMPLATE_ID);

    const frame = screen.getByTestId("cert-specimen-frame");
    expect(frame).toHaveAttribute("src", "blob:specimen");
    // Which artwork is being shown, since the two look alike at a glance.
    expect(screen.getByText(/Internship artwork/)).toBeInTheDocument();
  });

  // The point of the notice: nobody should be able to look at this and think a certificate
  // was issued, or that "Sample Student" holds one.
  it("says the values are placeholders and that nothing was issued or saved", async () => {
    const user = userEvent.setup();
    useCertificateTemplateSpecimenMock.mockReturnValue(specimenState({ data: SPECIMEN }));

    render(<CertTemplateSpecimenDrawer open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByTestId("cert-template-select"), TEMPLATE_ID);

    const notice = screen.getByTestId("cert-specimen-notice");
    expect(notice).toHaveTextContent(/placeholder/i);
    expect(notice).toHaveTextContent(/not pass verification/i);
    expect(notice).toHaveTextContent(/Nothing was issued and nothing was saved/i);
  });

  it("surfaces a failed render instead of an empty frame", async () => {
    const user = userEvent.setup();
    useCertificateTemplateSpecimenMock.mockReturnValue(
      specimenState({ isError: true, error: new Error("artwork missing") }),
    );

    render(<CertTemplateSpecimenDrawer open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByTestId("cert-template-select"), TEMPLATE_ID);

    expect(screen.getByTestId("cert-specimen-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cert-specimen-frame")).not.toBeInTheDocument();
  });
});
