// Certificate preview — the actual document, inside the CRM.
//
// WHY THIS EXISTS. The certificate screens could show everything ABOUT an award — holder,
// cohort, serial, status, who issued it, a public verify link — and not the award. The only
// way anybody inside the company could see what a student receives was to log in as that
// student, so in practice nobody looked, and a change to the certificate design was
// something you found out about from a student. Issuing a document you cannot look at is
// not a review step, it is a button.
//
// It frames the REAL PDF — the stored bytes, fetched through a signed URL — rather than
// re-drawing a likeness in HTML. A preview that is "roughly" the certificate is worse than
// none: it would disagree with the file in exactly the small ways (a typeface, a margin, a
// date format) that somebody opens a preview to check.
import * as React from "react";
import { Download, ExternalLink } from "lucide-react";
import { Alert, Button, Modal, Skeleton } from "@repo/ui";

import { useCertificateFileUrl } from "../../hooks/use-certificates";
import { queryErrorMessage } from "../../lib/surface-error";

interface CertificatePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while closed — the query stays disabled, so no URL is minted for a shut panel. */
  certificateId: string | null;
  studentName?: string;
  programTitle?: string;
  /** Revoked certificates are still viewable by staff; the banner says so. */
  revoked?: boolean;
}

export function CertificatePreviewDialog({
  open,
  onOpenChange,
  certificateId,
  studentName,
  programTitle,
  revoked = false,
}: CertificatePreviewDialogProps): React.JSX.Element {
  const activeId = open ? certificateId : null;
  const preview = useCertificateFileUrl(activeId, "inline");

  // The saveable URL is minted only when somebody actually asks to save, so opening a
  // preview does not mint two signed credentials for a file most people only look at.
  const [wantsDownload, setWantsDownload] = React.useState(false);
  const download = useCertificateFileUrl(wantsDownload ? activeId : null, "attachment");

  React.useEffect(() => {
    if (!open) setWantsDownload(false);
  }, [open]);

  // Navigating to an `attachment` URL saves the file without leaving the page; the anchor's
  // own `download` attribute is ignored cross-origin, which is why the disposition is baked
  // into the signed URL instead.
  React.useEffect(() => {
    if (!wantsDownload || !download.data) return;
    window.location.assign(download.data.downloadUrl);
    setWantsDownload(false);
  }, [wantsDownload, download.data]);

  const subtitle = [studentName, programTitle].filter(Boolean).join(" · ");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Certificate"
      description={subtitle || "The document issued to the student."}
      size="lg"
      // Wider than the design system's largest preset: this is a landscape document, and at
      // the default width the body paragraph is too small to read, which defeats the panel.
      className="sm:max-w-5xl"
      data-testid="certificate-preview-dialog"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-muted">
            This is the exact PDF the student downloads.
          </p>
          <div className="flex items-center gap-2">
            {preview.data ? (
              <a
                href={preview.data.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="certificate-preview-new-tab"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open in new tab
              </a>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => setWantsDownload(true)}
              disabled={!certificateId || download.isFetching}
              data-testid="certificate-preview-download"
            >
              <Download className="mr-1.5 size-4" aria-hidden="true" />
              {download.isFetching ? "Preparing…" : "Download PDF"}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {revoked ? (
          <Alert tone="warning" data-testid="certificate-preview-revoked">
            This certificate has been revoked. The student can no longer download it and the
            public verify page reports it as revoked — staff can still read the document here.
          </Alert>
        ) : null}

        {download.isError ? (
          <Alert tone="danger">
            {queryErrorMessage(download.error, "The certificate could not be prepared for download.")}
          </Alert>
        ) : null}

        {preview.isPending ? (
          // Reserve the document's own proportions, so the panel does not resize under the
          // reader the moment the PDF arrives.
          <Skeleton className="aspect-[3/2] w-full rounded-lg" data-testid="certificate-preview-loading" />
        ) : preview.isError ? (
          <Alert tone="danger" data-testid="certificate-preview-error">
            {queryErrorMessage(preview.error, "The certificate document could not be loaded.")}
          </Alert>
        ) : preview.data ? (
          <iframe
            // Keyed on the URL so a refetched (re-signed) URL remounts the frame rather than
            // leaving the expired one on screen.
            key={preview.data.downloadUrl}
            src={preview.data.downloadUrl}
            title={`Certificate for ${studentName ?? "this student"}`}
            className="aspect-[3/2] w-full rounded-lg border border-border bg-surface"
            data-testid="certificate-preview-frame"
          />
        ) : null}
      </div>
    </Modal>
  );
}
