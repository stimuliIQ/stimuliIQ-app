// Certificate specimen — the document a template issues, before anybody is issued one.
//
// WHAT THIS REPLACED. A "certificate template designer" drawer sat here and let staff drag
// merge-field placeholders — {{student_name}}, {{program_title}}, {{issued_at}},
// {{cert_uid}} — around a blank canvas. It carried a warning that positions were not
// saved, but the deeper problem was that none of it described the real certificate:
//
//   * Since the artwork change, the certificate IS the approved design printed full-bleed
//     with FOUR values drawn on top (holderName, body, certificateId, issuedAt). There is
//     no blank canvas and no {{program_title}} field — the programme name lives inside the
//     body paragraph.
//   * `CertificateTemplate.layout`, the column that drawer wrote to, is documented as
//     "UI-designer-only, not consumed by rendering". Positions moved there changed nothing.
//
// So it showed a layout that was not the layout, for fields that were not the fields, and
// saved to a column the renderer ignores. Somebody checking a certificate there would come
// away confident about a document they had not seen.
//
// This drawer renders the real thing through the same CertificatePdfPort that issuance
// uses. It is a viewer, not an editor: placements come from the approved artwork by
// construction, and the way to change them is to change the artwork.
import * as React from "react";
import { Alert, Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Select, SelectItem, Skeleton, StatusChip } from "@repo/ui";

import { useCertificateTemplates, useCertificateTemplateSpecimen } from "../../hooks/use-certificates";
import { queryErrorMessage } from "../../lib/surface-error";

interface CertTemplateSpecimenDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Base64 PDF -> object URL for the <iframe>.
 *
 * A `data:application/pdf;base64,…` src is refused or silently blanked by several browsers'
 * PDF viewers, and at ~1.9 MB of base64 it would also be an enormous attribute. A blob URL
 * renders reliably and is revoked when the bytes change or the drawer unmounts, so the
 * document does not sit in memory behind a closed panel.
 */
function usePdfObjectUrl(bytesBase64: string | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!bytesBase64) {
      setUrl(null);
      return;
    }
    const binary = atob(bytesBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytesBase64]);

  return url;
}

export function CertTemplateSpecimenDrawer({ open, onOpenChange }: CertTemplateSpecimenDrawerProps): React.JSX.Element {
  const { data: templates } = useCertificateTemplates();
  const [templateId, setTemplateId] = React.useState<string | undefined>(undefined);

  // Only fetch while the drawer is open: 1.4 MB should not be rendered server-side and
  // shipped for a panel nobody has opened.
  const specimen = useCertificateTemplateSpecimen(open && templateId ? templateId : null);
  const pdfUrl = usePdfObjectUrl(specimen.data?.bytesBase64);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Certificate preview"
        description="The document a template issues, rendered exactly as a student receives it."
        size="lg"
        data-testid="cert-template-specimen-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          <Select
            label="Template"
            placeholder="Select a template"
            value={templateId}
            onValueChange={setTemplateId}
            data-testid="cert-template-select"
          >
            {(templates ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </Select>

          {!templateId ? (
            <EmptyState
              title="Pick a template"
              description="Choose a template above to see the certificate it produces."
              data-testid="cert-specimen-empty"
            />
          ) : specimen.isLoading ? (
            <>
              {/* The render runs the real PDF pipeline, so this takes a moment. */}
              <Skeleton shape="block" className="aspect-[3/2] w-full rounded-lg" />
              <p className="text-sm text-fg-muted">Rendering the certificate…</p>
            </>
          ) : specimen.isError ? (
            <EmptyState
              title="Couldn't render this template"
              description={queryErrorMessage(
                specimen.error,
                "The certificate could not be rendered. This usually means the template's artwork or fonts are missing on the server.",
              )}
              action={
                <Button variant="secondary" onClick={() => void specimen.refetch()} data-testid="cert-specimen-retry">
                  Try again
                </Button>
              }
              data-testid="cert-specimen-error"
            />
          ) : specimen.data ? (
            <>
              <Alert tone="info" data-testid="cert-specimen-notice">
                This is the real certificate, rendered by the same code that issues them, on the approved artwork.
                The name, programme and certificate number below are placeholders, so this document certifies nobody
                and will not pass verification. Nothing was issued and nothing was saved.
              </Alert>

              <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                <StatusChip
                  tone="info"
                  label={specimen.data.certificateKind === "internship" ? "Internship artwork" : "Training artwork"}
                  size="sm"
                />
                <span>{specimen.data.sample.holderName}</span>
                <span aria-hidden="true">·</span>
                <span>{specimen.data.sample.programName}</span>
              </div>

              {pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  title={`Certificate produced by ${specimen.data.templateName}`}
                  className="aspect-[3/2] w-full rounded-lg border border-border bg-surface"
                  data-testid="cert-specimen-frame"
                />
              ) : null}
            </>
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="cert-specimen-close">
            Close
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
