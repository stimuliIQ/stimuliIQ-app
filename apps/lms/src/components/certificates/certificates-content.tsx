// CertificatesContent — student certificate list + download.
//
// Renders a CertificateCard for each issued certificate.
// Download: calls getDownloadUrl() on-demand (NEVER cached) → opens signed URL.
//   Handles 410 CERTIFICATE_REVOKED and 404 (AC-F5, AC-F2/F3/F4).
//
// SECURITY:
//   - Download URLs are short-lived and never stored in component state beyond
//     immediate use (the URL is opened directly, not persisted).
//   - Revoked certificates show the revoked chip (CertificateCard) and
//     a disabled download button.
//
// CLAUDE.md §3: no business logic in components.
"use client";

import * as React from "react";
import { Award, Linkedin } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  CertificateCard,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@repo/ui";
import type { CertificateListItem } from "@repo/types";

import { useMyCertificates, useDownloadCertificate } from "../../hooks/use-certificates";

// ---------------------------------------------------------------------------
// LinkedIn "Add to Profile" share link — Phase 9 Completion, T36
// (docs/plans/phase-9-completion.md, docs/02 §7.11 "share to LinkedIn"). Uses
// LinkedIn's documented certification-add deep link with the same public verify
// URL already computed below (never a signed download URL — that's short-lived
// and would break as soon as it expires on LinkedIn's side).
// ---------------------------------------------------------------------------

function buildLinkedInAddUrl(params: {
  programTitle: string;
  issuedAt: string;
  verifyUrl: string;
  // Credential ID shown on the LinkedIn profile — the short, human-readable serial.
  serial: string;
}): string {
  const issued = new Date(params.issuedAt);
  const url = new URL("https://www.linkedin.com/profile/add");
  url.searchParams.set("startTask", "CERTIFICATION_NAME");
  url.searchParams.set("name", params.programTitle);
  url.searchParams.set("organizationName", "stimuliiq");
  url.searchParams.set("issueYear", String(issued.getUTCFullYear()));
  url.searchParams.set("issueMonth", String(issued.getUTCMonth() + 1));
  url.searchParams.set("certUrl", params.verifyUrl);
  url.searchParams.set("certId", params.serial);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CertificatesSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading certificates">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} shape="block" className="h-44 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single certificate item — wraps CertificateCard with download logic
// ---------------------------------------------------------------------------

interface CertificateItemProps {
  cert: CertificateListItem;
  holderName: string;
}

function CertificateItem({ cert, holderName }: CertificateItemProps): React.JSX.Element {
  const { download, isDownloading, downloadError, clearError } = useDownloadCertificate();
  const [localError, setLocalError] = React.useState<string | null>(null);

  const handleDownload = async () => {
    clearError();
    setLocalError(null);
    const result = await download(cert.id);
    if (result) {
      // Open the short-lived signed URL immediately — do NOT store it
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  };

  const displayError =
    downloadError?.message ?? localError;

  const verifyBaseUrl = process.env.NEXT_PUBLIC_VERIFY_URL ?? "https://stimuliiq.com/verify";
  const verifyUrl = `${verifyBaseUrl}/${encodeURIComponent(cert.certUid)}`;

  return (
    <li data-testid={`certificate-item-${cert.id}`} className="flex flex-col">
      <CertificateCard
        programName={cert.programTitle}
        holderName={holderName}
        issuedAt={cert.issuedAt}
        status={cert.status === "valid" ? "valid" : "revoked"}
        // Download URL is fetched on-demand — not stored here
        downloadUrl={null}
        downloadUnavailableReason={
          cert.status === "revoked"
            ? "This certificate has been revoked and is no longer available for download."
            : undefined
        }
        verifyUrl={verifyUrl}
        certUid={cert.certUid}
        onDownload={() => void handleDownload()}
        data-testid={`certificate-card-${cert.id}`}
      />

      {/* Short, human-typeable Certificate ID — the value anyone can type into /verify. */}
      <p className="mt-1 text-xs text-fg-muted" data-testid={`certificate-serial-${cert.id}`}>
        Certificate ID: <span className="font-mono font-medium text-fg">{cert.serial}</span>
      </p>

      {/* Download button (overriding CertificateCard's static download since we need async) */}
      {cert.status === "valid" ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            loading={isDownloading}
            disabled={isDownloading}
            onClick={() => void handleDownload()}
            data-testid={`certificate-download-btn-${cert.id}`}
            aria-label={`Download certificate for ${cert.programTitle}`}
          >
            Download PDF
          </Button>
          <Button asChild variant="secondary" size="sm" data-testid={`certificate-linkedin-btn-${cert.id}`}>
            <a
              href={buildLinkedInAddUrl({
                programTitle: cert.programTitle,
                issuedAt: cert.issuedAt,
                verifyUrl,
                serial: cert.serial,
              })}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Add ${cert.programTitle} certificate to LinkedIn profile`}
            >
              <Linkedin aria-hidden="true" className="size-4" />
              Add to LinkedIn
            </a>
          </Button>
          {displayError ? (
            <p role="alert" className="text-sm text-danger" data-testid={`certificate-download-error-${cert.id}`}>
              {displayError}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// CertificatesContent — top-level client component
// ---------------------------------------------------------------------------

interface CertificatesContentProps {
  /** Holder's display name — from useMe() in the parent page */
  holderName: string;
}

export function CertificatesContent({ holderName }: CertificatesContentProps): React.JSX.Element {
  const { certificates, isLoading, isSignedOut, isError, error, refetch } = useMyCertificates();

  if (isLoading) return <CertificatesSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="certificates-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to see your certificates.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild data-testid="certificates-sign-in-cta">
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="certificates-error">
        <CardHeader>
          <CardTitle>Failed to load certificates</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="certificates-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (certificates.length === 0) {
    return (
      <EmptyState
        data-testid="certificates-empty"
        icon={<Award className="size-10" strokeWidth={1.5} />}
        title="No certificates yet"
        description="Complete your course requirements — assessments passed, project approved — and your instructor will issue your certificate."
      />
    );
  }

  return (
    <div data-testid="certificates-content" className="space-y-6 md:space-y-8">
      <PageHeader title="My Certificates" />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="My certificates">
        {certificates.map((cert) => (
          <CertificateItem key={cert.id} cert={cert} holderName={holderName} />
        ))}
      </ul>
    </div>
  );
}
