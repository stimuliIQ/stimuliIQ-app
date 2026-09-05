// Bulk certificate issuance — Phase 9 Completion T39.
//
// GAP: there is no bulk-issue endpoint (`client.crm.bulk.*` only covers
// leads/students — see @repo/types crm/bulk-actions.schemas.ts file header;
// certificates.issue() is single-enrollment). This dialog issues
// sequentially, one `certificates.issue()` call per selected ELIGIBLE,
// not-yet-issued enrollment, and reports a per-row success/failure summary
// — the same UX contract the real `BulkActionResponse` shape offers
// elsewhere, just computed client-side instead of in one atomic request.
import * as React from "react";
import { Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, Select, SelectItem, StatusChip, useToast } from "@repo/ui";
import type { EligibilityListItem } from "@repo/types";
import { CERTIFICATE_KIND_LABEL } from "@repo/types";

import { useCertificateTemplates, useIssueCertificate } from "../../hooks/use-certificates";
import { queryErrorMessage } from "../../lib/surface-error";

interface BulkIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: EligibilityListItem[];
  onDone: () => void;
}

type RowResult = { enrollmentId: string; studentName: string; success: boolean; error?: string };

export function BulkIssueDialog({ open, onOpenChange, candidates, onDone }: BulkIssueDialogProps): React.JSX.Element {
  const { data: templates } = useCertificateTemplates();
  const issueCertificate = useIssueCertificate();
  const { toast } = useToast();

  const [templateId, setTemplateId] = React.useState<string | undefined>(undefined);
  // The award comes FROM the template, never from a second picker: the template carries the
  // artwork whose ribbon reads TRAINING or INTERNSHIP, so asking separately would let the
  // issued row contradict the document the student receives.
  const selectedTemplate = (templates ?? []).find((t) => t.id === templateId);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<RowResult[] | null>(null);

  React.useEffect(() => {
    if (!open) {
      setResults(null);
      setRunning(false);
    }
  }, [open]);

  const issuable = candidates.filter((c) => c.eligibility.eligible && !c.certificateStatus);

  async function handleIssueAll() {
    if (!templateId || !selectedTemplate) return;
    setRunning(true);
    const rowResults: RowResult[] = [];
    for (const candidate of issuable) {
      try {
        await issueCertificate.mutateAsync({
          enrollmentId: candidate.enrollmentId,
          templateId,
          kind: selectedTemplate.kind,
          overrideEligibility: false,
        });
        rowResults.push({ enrollmentId: candidate.enrollmentId, studentName: candidate.studentName, success: true });
      } catch (error) {
        const message = queryErrorMessage(error, "Failed");
        rowResults.push({ enrollmentId: candidate.enrollmentId, studentName: candidate.studentName, success: false, error: message });
      }
    }
    setResults(rowResults);
    setRunning(false);
    onDone();
    const successCount = rowResults.filter((r) => r.success).length;
    toast({
      title: "Bulk issuance complete",
      description: `${successCount} of ${rowResults.length} certificates issued.`,
      variant: successCount === rowResults.length ? "success" : "default",
    });
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Bulk issue certificates" description={`${issuable.length} of ${candidates.length} selected rows are eligible and not yet issued.`} size="md" data-testid="bulk-issue-dialog">
        <DrawerBody className="flex flex-col gap-4">
          {!results ? (
            <>
              <Select
                label="Certificate template"
                required
                placeholder="Select a template"
                value={templateId}
                onValueChange={setTemplateId}
                data-testid="bulk-issue-template-select"
              >
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}, {CERTIFICATE_KIND_LABEL[t.kind]}
                  </SelectItem>
                ))}
              </Select>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm text-fg-muted" aria-label="Students to be issued">
                {issuable.map((c) => (
                  <li key={c.enrollmentId}>{c.studentName}</li>
                ))}
              </ul>
              {candidates.length - issuable.length > 0 ? (
                <p className="text-xs text-fg-subtle">
                  {candidates.length - issuable.length} selected row(s) skipped (not eligible or already issued).
                </p>
              ) : null}
            </>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Bulk issuance results" data-testid="bulk-issue-results">
              {results.map((r) => (
                <li key={r.enrollmentId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-fg">{r.studentName}</span>
                  {r.success ? (
                    <StatusChip tone="success" label="Issued" size="sm" />
                  ) : (
                    <StatusChip tone="danger" label={r.error ?? "Failed"} size="sm" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </DrawerBody>
        <DrawerFooter>
          {results ? (
            <Button onClick={() => onOpenChange(false)} data-testid="bulk-issue-close">
              Close
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={running}>
                Cancel
              </Button>
              <Button onClick={handleIssueAll} loading={running} disabled={!templateId || issuable.length === 0} data-testid="bulk-issue-confirm">
                Issue {issuable.length} certificate{issuable.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
