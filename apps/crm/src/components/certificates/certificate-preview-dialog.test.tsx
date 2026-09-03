// Tests for the certificate preview panel.
//
// The panel exists so somebody inside the company can see the document a student receives
// instead of only its metadata, and the things worth pinning are the ones that would make
// it quietly useless: framing a URL that a browser downloads instead of rendering, minting
// a second signed credential for a file nobody asked to save, and hiding a revoked
// certificate from the staff who are being asked about it.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

const INLINE_URL = "https://storage.test/signed/inline.pdf";
const ATTACHMENT_URL = "https://storage.test/signed/attachment.pdf";

const useCertificateFileUrl = vi.fn();

vi.mock("../../hooks/use-certificates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-certificates")>();
  return { ...actual, useCertificateFileUrl: (...args: unknown[]) => useCertificateFileUrl(...args) };
});

import { CertificatePreviewDialog } from "./certificate-preview-dialog";

/** The hook is called once per disposition; answer each with its own URL. */
function stubUrls(over: { inline?: unknown; attachment?: unknown } = {}) {
  useCertificateFileUrl.mockImplementation((id: string | null, disposition: string) => {
    if (!id) return { data: undefined, isPending: true, isError: false, isFetching: false };
    const custom = disposition === "inline" ? over.inline : over.attachment;
    if (custom) return custom;
    return {
      data: {
        downloadUrl: disposition === "inline" ? INLINE_URL : ATTACHMENT_URL,
        expiresAt: "2026-09-03T12:00:00.000Z",
        filename: "Certificate-Clinical-Neurology.pdf",
      },
      isPending: false,
      isError: false,
      isFetching: false,
    };
  });
}

function renderDialog(props: Partial<React.ComponentProps<typeof CertificatePreviewDialog>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CertificatePreviewDialog
          open
          onOpenChange={() => {}}
          certificateId="55555555-5555-4555-8555-555555555555"
          studentName="Sneha Iyer"
          programTitle="Clinical Neurology Fellowship"
          {...props}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCertificateFileUrl.mockReset();
  stubUrls();
});

describe("CertificatePreviewDialog", () => {
  it("frames the real PDF, using the URL that renders rather than the one that downloads", () => {
    // A PDF served as `Content-Disposition: attachment` is saved by the browser, never
    // drawn — frame that URL and the panel is an empty box.
    renderDialog();

    expect(screen.getByTestId("certificate-preview-frame")).toHaveAttribute("src", INLINE_URL);
    expect(useCertificateFileUrl).toHaveBeenCalledWith(expect.any(String), "inline");
  });

  it("does not mint a saveable URL until somebody asks to save", () => {
    // A signed URL is a bearer credential for the object. Opening a preview should not
    // create two of them for a document most people only look at.
    renderDialog();

    expect(useCertificateFileUrl).not.toHaveBeenCalledWith(expect.any(String), "attachment");
    expect(useCertificateFileUrl).toHaveBeenCalledWith(null, "attachment");
  });

  it("asks for the saveable URL once Download is pressed", async () => {
    const user = userEvent.setup();
    // jsdom does not implement navigation; the assertion is that we went somewhere.
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, configurable: true, writable: true });

    renderDialog();
    await user.click(screen.getByTestId("certificate-preview-download"));

    expect(useCertificateFileUrl).toHaveBeenCalledWith(expect.any(String), "attachment");
    expect(assign).toHaveBeenCalledWith(ATTACHMENT_URL);
  });

  it("still shows a REVOKED certificate, and says that it is revoked", () => {
    // Staff being asked about a revoked award are exactly the people who need to read it;
    // the student already holds their copy either way.
    renderDialog({ revoked: true });

    expect(screen.getByTestId("certificate-preview-revoked")).toBeInTheDocument();
    expect(screen.getByTestId("certificate-preview-frame")).toBeInTheDocument();
  });

  it("says what went wrong rather than showing an empty frame", () => {
    stubUrls({
      inline: { data: undefined, isPending: false, isError: true, error: new Error("nope"), isFetching: false },
    });

    renderDialog();

    expect(screen.getByTestId("certificate-preview-error")).toBeInTheDocument();
    expect(screen.queryByTestId("certificate-preview-frame")).not.toBeInTheDocument();
  });

  it("mints nothing at all while it is closed", () => {
    renderDialog({ open: false });

    expect(useCertificateFileUrl).toHaveBeenCalledWith(null, "inline");
    expect(useCertificateFileUrl).not.toHaveBeenCalledWith(expect.any(String), "inline");
  });
});
