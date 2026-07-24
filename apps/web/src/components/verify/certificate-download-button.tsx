"use client";

// CertificateDownloadButton — the "Download certificate" action on the public verify page.
//
// VerifyPanel is a server component, so the click handler lives here in its own client
// island rather than turning the whole panel into one.
//
// Flow: GET /verify/:certUid/download mints a SHORT-LIVED signed URL for the PDF (the
// bytes are never proxied through this app), then we navigate to it. Unauthenticated by
// design — holding a valid signed cert_uid is the authorisation, and the PDF shows nothing
// the page above it doesn't already. A revoked certificate is 410 Gone server-side, so this
// button is only rendered for a VALID certificate.

import * as React from "react";
import { Button } from "@repo/ui";

import { apiClient } from "../../lib/api-client";

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

export function CertificateDownloadButton({ certUid }: { certUid: string }): React.JSX.Element {
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDownload() {
    setIsLoading(true);
    setError(null);
    try {
      const { downloadUrl, filename } = await apiClient.learning.certificates.downloadPublic(certUid);

      // An <a download> click rather than window.open: keeps the suggested filename and
      // doesn't get swallowed by pop-up blockers.
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't prepare the download. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <Button
        onClick={handleDownload}
        loading={isLoading}
        className="w-full"
        data-testid="verify-download-button"
      >
        <DownloadIcon className="size-4" />
        Download certificate
      </Button>
      {error ? (
        <p role="alert" className="text-center text-xs text-danger" data-testid="verify-download-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

CertificateDownloadButton.displayName = "CertificateDownloadButton";
