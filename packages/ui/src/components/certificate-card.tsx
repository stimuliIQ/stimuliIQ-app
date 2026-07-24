import * as React from "react";
import { Award, Download, ExternalLink, ShieldCheck } from "lucide-react";

import { cn } from "../lib/cn";
import { Button } from "./button";
import { StatusChip, type StatusChipTone } from "./status-chip";

/**
 * CertificateCard — displays a certificate thumbnail, program name, holder, issue date,
 * a download CTA (disabled + explained when the certificate is not yet available/issued),
 * a public verify link, and a StatusChip (valid | revoked).
 *
 * Per docs/07-design-system.md §5/§11, docs/02-prd-lms.md §7.11.
 *
 * Design rules:
 * - Status is never conveyed by color alone: StatusChip + label.
 * - Download is disabled when `downloadUrl` is null; the disabled reason is communicated
 *   via aria-describedby (not just grayed-out without explanation).
 * - Verify link opens in a new tab with a descriptive aria-label (no "click here").
 * - Thumbnail alt text is meaningful (not "certificate image").
 *
 * Usage:
 *   <CertificateCard
 *     programName="Full Stack Development"
 *     holderName="Aditi Sharma"
 *     issuedAt="2025-12-01"
 *     status="valid"
 *     downloadUrl="/api/certificates/abc123/download"
 *     verifyUrl="https://stimuliiq.com/verify/CERT-abc123"
 *     certUid="CERT-abc123"
 *   />
 *
 *   // Not yet issued:
 *   <CertificateCard
 *     programName="Data Science Bootcamp"
 *     holderName="Rahul Gupta"
 *     status="pending"
 *     downloadUrl={null}
 *     downloadUnavailableReason="Certificate will be available once you complete all requirements."
 *   />
 */

export type CertificateStatus = "valid" | "revoked" | "pending";

const statusToneMap: Record<CertificateStatus, StatusChipTone> = {
  valid: "success",
  revoked: "danger",
  pending: "neutral",
};

const statusLabelMap: Record<CertificateStatus, string> = {
  valid: "Valid",
  revoked: "Revoked",
  pending: "Pending",
};

export interface CertificateCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Full program / course name displayed on the card. */
  programName: string;
  /** Certificate holder's full name. */
  holderName: string;
  /**
   * ISO date string or pre-formatted string for the issue date.
   * When omitted (e.g. pending), "Not yet issued" is shown.
   */
  issuedAt?: string;
  /** Certificate status; drives the StatusChip and disables download when not "valid". */
  status: CertificateStatus;
  /**
   * Signed download URL (short-TTL) — minted by the backend on demand.
   * Pass `null` when the certificate is not yet available (pending / revoked).
   */
  downloadUrl: string | null;
  /**
   * Human-readable reason shown when downloadUrl is null (e.g.
   * "Complete all course requirements to unlock your certificate.").
   * Required when downloadUrl is null so the disabled state is explained accessibly.
   */
  downloadUnavailableReason?: string;
  /** Public verify page URL (e.g. "https://stimuliiq.com/verify/CERT-abc123"). */
  verifyUrl?: string;
  /** The verifiable certificate UID (used in aria-labels for verify link). */
  certUid?: string;
  /** Optional thumbnail image src. Falls back to a decorative certificate icon. */
  thumbnailSrc?: string;
  /** Called when the user clicks the download button (in addition to the href navigation).
   *  Useful for analytics / audit logging from the parent. */
  onDownload?: () => void;
  /** Test hook; defaults to "certificate-card" when omitted. */
  "data-testid"?: string;
}

export const CertificateCard = React.forwardRef<HTMLDivElement, CertificateCardProps>(
  (
    {
      programName,
      holderName,
      issuedAt,
      status,
      downloadUrl,
      downloadUnavailableReason,
      verifyUrl,
      certUid,
      thumbnailSrc,
      onDownload,
      className,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const unavailableId = React.useId();
    const canDownload = Boolean(downloadUrl) && status !== "revoked";

    const formattedDate = issuedAt
      ? new Date(issuedAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

    return (
      <div
        ref={ref}
        data-testid={testId ?? "certificate-card"}
        className={cn(
          "flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm",
          "sm:flex-row sm:items-start",
          className,
        )}
        {...props}
      >
        {/* Thumbnail */}
        <div
          className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md border border-border bg-surface"
          aria-hidden={!thumbnailSrc}
        >
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={`Certificate thumbnail for ${programName}`}
              className="h-full w-full rounded-md object-cover"
            />
          ) : (
            <Award
              className="size-10 text-fg-subtle"
              aria-hidden="true"
              strokeWidth={1.5}
            />
          )}
        </div>

        {/* Content — min-w-0 lets this flex child shrink below its content width so a long
            certUid token truncates instead of forcing the whole card past the viewport. */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-semibold text-fg">{programName}</h3>
              <p className="text-sm text-fg-muted">{holderName}</p>
              {formattedDate ? (
                <p className="text-xs text-fg-subtle">
                  <span className="sr-only">Issued on </span>
                  {formattedDate}
                </p>
              ) : (
                <p className="text-xs text-fg-subtle">Not yet issued</p>
              )}
            </div>
            <StatusChip
              tone={statusToneMap[status]}
              label={statusLabelMap[status]}
              size="sm"
              data-testid="certificate-card-status"
            />
          </div>

          {/* Certificate ID — the certUid is a long signed token; truncate to one line
              (full value on hover / for screen readers) so it never overflows the card. */}
          {certUid ? (
            <p className="max-w-full truncate font-mono text-xs text-fg-subtle" title={certUid}>
              <span className="sr-only">Certificate ID: </span>
              {certUid}
            </p>
          ) : null}

          {/* Unavailable reason (hidden from layout but linked via aria-describedby) */}
          {!canDownload && downloadUnavailableReason ? (
            <p
              id={unavailableId}
              className="text-xs text-fg-muted"
              data-testid="certificate-card-unavailable-reason"
            >
              {downloadUnavailableReason}
            </p>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {canDownload ? (
              <Button
                variant="primary"
                size="sm"
                asChild
                onClick={onDownload}
                data-testid="certificate-card-download"
              >
                <a
                  href={downloadUrl!}
                  download
                  aria-label={`Download certificate for ${programName}`}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Download PDF
                </a>
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled
                aria-disabled="true"
                aria-describedby={downloadUnavailableReason ? unavailableId : undefined}
                data-testid="certificate-card-download"
              >
                <Download className="size-3.5" aria-hidden="true" />
                Download PDF
              </Button>
            )}

            {verifyUrl ? (
              <Button
                variant="ghost"
                size="sm"
                asChild
                data-testid="certificate-card-verify"
              >
                <a
                  href={verifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Verify certificate${certUid ? ` ${certUid}` : ""} on the public verification page (opens in a new tab)`}
                >
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Verify
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);
CertificateCard.displayName = "CertificateCard";
