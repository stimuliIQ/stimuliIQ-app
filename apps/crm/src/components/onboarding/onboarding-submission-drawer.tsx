// Read one student's onboarding submission and triage it.
//
// The answers are RENDERED FROM THE STORED SNAPSHOT, not from today's field list. That is
// what makes a submission from before a form edit still read correctly: it shows the
// question as it was actually asked, even if staff have since renamed or deleted it.
// Consequently, nothing here is editable except `status` and `reviewNotes` — the answers
// are the record of what the student sent, and an editable record is not evidence.
import * as React from "react";
import { Download, ExternalLink } from "lucide-react";
import {
  Alert,
  Button,
  DetailGrid,
  DetailRow,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  Select,
  SelectItem,
  StatusChip,
  Textarea,
  statusTone,
  useToast,
} from "@repo/ui";
import type { OnboardingAnswer, OnboardingSubmissionStatus } from "@repo/types";

import { useOnboardingSubmission, useUpdateOnboardingSubmission } from "../../hooks/use-onboarding";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: Array<{ value: OnboardingSubmissionStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

/** Maps the workflow enum onto the canonical CRM tone vocabulary (crm-ui-consistency §2). */
export function submissionStatusTone(status: OnboardingSubmissionStatus) {
  return statusTone(status === "in_review" ? "in-progress" : status === "verified" ? "completed" : status);
}

export interface OnboardingSubmissionDrawerProps {
  submissionId: string | null;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

export function OnboardingSubmissionDrawer({
  submissionId,
  onOpenChange,
  canEdit,
}: OnboardingSubmissionDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const { data, isLoading, isError } = useOnboardingSubmission(submissionId);
  const updateSubmission = useUpdateOnboardingSubmission();

  const [status, setStatus] = React.useState<OnboardingSubmissionStatus>("new");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!data) return;
    setStatus(data.status);
    setNotes(data.reviewNotes ?? "");
  }, [data]);

  const dirty = Boolean(data) && (status !== data?.status || notes !== (data?.reviewNotes ?? ""));

  async function handleSave(): Promise<void> {
    if (!data) return;
    try {
      await updateSubmission.mutateAsync({
        id: data.id,
        body: { status, reviewNotes: notes.trim() ? notes.trim() : null },
      });
      toast({ title: "Submission updated", variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this submission");
    }
  }

  return (
    <Drawer open={Boolean(submissionId)} onOpenChange={onOpenChange}>
      <DrawerContent title="Onboarding submission" size="lg" data-testid="onboarding-submission-drawer">
        <DrawerBody className="flex flex-col gap-5">
          {isLoading ? <p className="text-sm text-fg-muted">Loading…</p> : null}
          {isError ? <Alert tone="danger" title="Couldn't load this submission" /> : null}

          {data ? (
            <>
              <DetailGrid columns={2}>
                <DetailRow label="Name">{data.fullName ?? "—"}</DetailRow>
                <DetailRow label="Status">
                  <StatusChip tone={submissionStatusTone(data.status)} label={data.status.replace("_", " ")} size="sm" />
                </DetailRow>
                <DetailRow label="Email">{data.email ?? "—"}</DetailRow>
                <DetailRow label="Phone">{data.phone ?? "—"}</DetailRow>
                <DetailRow label="Program">{data.programTitle ?? "—"}</DetailRow>
                <DetailRow label="Submitted">{new Date(data.createdAt).toLocaleString()}</DetailRow>
                {data.reviewedByName ? (
                  <DetailRow label="Last reviewed by">
                    {data.reviewedByName}
                    {data.reviewedAt ? ` · ${new Date(data.reviewedAt).toLocaleString()}` : ""}
                  </DetailRow>
                ) : null}
              </DetailGrid>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-fg">All answers</h3>
                <dl className="divide-y divide-border rounded-md border border-border">
                  {data.answers.length === 0 ? (
                    <p className="p-3 text-sm text-fg-subtle">No answers recorded.</p>
                  ) : (
                    data.answers.map((answer) => (
                      <div key={answer.key} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
                        <dt className="text-sm font-medium text-fg-muted">{answer.label}</dt>
                        <dd className="text-sm text-fg">
                          <AnswerValue answer={answer} attachmentUrls={data.attachmentUrls} />
                        </dd>
                      </div>
                    ))
                  )}
                </dl>
              </section>

              {canEdit ? (
                <section className="flex flex-col gap-3 border-t border-border pt-4">
                  <Select
                    label="Status"
                    value={status}
                    onValueChange={(v) => setStatus(v as OnboardingSubmissionStatus)}
                    data-testid="onboarding-status-select"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </Select>
                  <Textarea
                    label="Internal notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    helperText="Only staff see this. The student is never shown these notes."
                    data-testid="onboarding-notes-input"
                  />
                </section>
              ) : null}
            </>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canEdit ? (
            <Button
              type="button"
              onClick={handleSave}
              loading={updateSubmission.isPending}
              disabled={!dirty}
              data-testid="onboarding-submission-save"
            >
              Save
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * One answer's value. File answers render as a link to a SHORT-LIVED signed URL minted by
 * this request — never a storage key, never a permanent URL. If signing failed server-side
 * the key is present but the URL is not, and we say so rather than rendering a dead link.
 */
function AnswerValue({
  answer,
  attachmentUrls,
}: {
  answer: OnboardingAnswer;
  attachmentUrls: Record<string, string>;
}): React.JSX.Element {
  if (answer.storageKey) {
    const url = attachmentUrls[answer.storageKey];
    if (!url) return <span className="text-fg-subtle">Attachment unavailable — try reopening this submission.</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-medium text-brand-500 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`onboarding-attachment-${answer.key}`}
      >
        <Download className="size-3.5" aria-hidden="true" />
        {answer.value ?? "Download file"}
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }
  if (answer.value === null || answer.value === "") return <span className="text-fg-subtle">—</span>;
  // `whitespace-pre-line` so a multi-line textarea answer (e.g. the referrals question)
  // keeps the line breaks the student typed.
  return <span className="whitespace-pre-line">{answer.value}</span>;
}
