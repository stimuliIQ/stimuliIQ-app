// Read one student's onboarding submission and decide on it.
//
// The answers are RENDERED FROM THE STORED SNAPSHOT, not from today's field list. That is
// what makes a submission from before a form edit still read correctly: it shows the
// question as it was actually asked, even if staff have since renamed or deleted it.
// Consequently, nothing here is editable except the decision and `reviewNotes` — the
// answers are the record of what the student sent, and an editable record is not evidence.
//
// TWO VERBS, NOT A STATUS PICKER. A submission arrives ON HOLD and stays there until
// someone accepts or rejects it, so the screen offers exactly those two buttons. A status
// dropdown was the wrong shape: it implied a set of interchangeable states, hid that only
// two were reachable, and could not offer "Accept" at all — accepting needs a batch and has
// consequences (enrolment, an invoice, an email), which is precisely what a silent status
// write must never carry.
//
// ACCEPT CONFIRMS INLINE, REJECT IN A DIALOG. Accepting needs two inputs, so it expands a
// panel inside the drawer where the receipt it is about to invoice is still on screen —
// a modal covering the evidence would be the wrong place to decide. Rejecting needs no
// input at all, only a yes/no about an email being sent, which is exactly ConfirmDialog.
import * as React from "react";
import { Check, Download, ExternalLink, X } from "lucide-react";
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
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

import {
  useApproveOnboardingSubmission,
  useOnboardingTaggableStaff,
  useOnboardingApprovableBatches,
  useOnboardingSubmission,
  useRejectOnboardingSubmission,
  useUpdateOnboardingSubmission,
} from "../../hooks/use-onboarding";
import { surfaceError } from "../../lib/surface-error";

/**
 * Maps the workflow enum onto the canonical CRM tone vocabulary (crm-ui-consistency §2).
 *
 * `pending` is the legacy arrival value (the DB default is `hold` since the
 * `onboarding_default_hold` migration) and means the same thing to a human, so it shares
 * both the in-progress tone and the label below.
 */
export function submissionStatusTone(status: OnboardingSubmissionStatus) {
  return statusTone(status === "approved" ? "completed" : status === "rejected" ? "rejected" : "in-progress");
}

/** What staff call each state. `pending` and `hold` are one state to a reviewer. */
export function submissionStatusLabel(status: OnboardingSubmissionStatus): string {
  switch (status) {
    case "approved":
      return "Accepted";
    case "rejected":
      return "Rejected";
    default:
      return "On hold";
  }
}

/** ₹25,000.00 from 2_500_000 paise — money is integer minor units end to end (CLAUDE.md §3.6). */
function formatPaise(paise: number, currency: string | null): string {
  const amount = (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency && currency !== "INR" ? `${currency} ${amount}` : `₹${amount}`;
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
  const approve = useApproveOnboardingSubmission();
  const reject = useRejectOnboardingSubmission();

  const [notes, setNotes] = React.useState("");
  /** null = reading; "accept" = the inline confirm panel is open; "reject" = the dialog is. */
  const [decision, setDecision] = React.useState<"accept" | "reject" | null>(null);
  const [batchId, setBatchId] = React.useState<string | undefined>(undefined);
  const [recordPayment, setRecordPayment] = React.useState(true);
  /** Who this member will belong to. Required — approving without it is what left an
   *  onboarding member owned by nobody, and their payment counted for nobody. */
  const [ownerUserId, setOwnerUserId] = React.useState<string | undefined>(undefined);

  // Batches are per-submission and only needed once the reviewer commits to accepting, so
  // they are fetched when the panel opens rather than on every row someone glances at.
  const batchesQuery = useOnboardingApprovableBatches(decision === "accept" ? submissionId : null);
  const batches = batchesQuery.data;

  // Fetched on the same trigger as batches. Deliberately NOT preselected to the signed-in
  // reviewer: the person working the queue is usually not the person who brought the
  // applicant in, and a prefilled wrong answer is accepted far more often than a blank one.
  const staffQuery = useOnboardingTaggableStaff(decision === "accept");
  const taggableStaff = staffQuery.data;

  React.useEffect(() => {
    setNotes(data?.reviewNotes ?? "");
    setDecision(null);
    setOwnerUserId(undefined);
  }, [data?.id, data?.reviewNotes]);

  React.useEffect(() => {
    // One candidate = nothing to decide. More than one and the reviewer must choose:
    // guessing would silently put a student in the wrong cohort.
    setBatchId(batches?.length === 1 ? batches[0]?.id : undefined);
  }, [batches]);

  // An accepted submission has an enrolled student behind it and the API refuses to
  // re-decide it, so the buttons go away rather than offering a click that can only 422.
  const settled = data?.status === "approved";
  const notesDirty = Boolean(data) && notes !== (data?.reviewNotes ?? "");
  const price = data?.programPricePaise ?? null;
  // A free/unpriced program has nothing to invoice — the server ignores the flag there, so
  // offering the checkbox would promise something that will not happen.
  const invoiceable = price !== null && price > 0;
  const trimmedNotes = notes.trim();

  async function handleSaveNotes(): Promise<void> {
    if (!data) return;
    try {
      await updateSubmission.mutateAsync({ id: data.id, body: { reviewNotes: trimmedNotes || null } });
      toast({ title: "Notes saved", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save these notes");
    }
  }

  async function handleAccept(): Promise<void> {
    if (!data || !batchId || !ownerUserId) return;
    try {
      const { activation } = await approve.mutateAsync({
        id: data.id,
        body: {
          batchId,
          ownerUserId,
          recordPayment: invoiceable && recordPayment,
          ...(trimmedNotes ? { reviewNotes: trimmedNotes } : {}),
        },
      });
      // Report what actually happened rather than "Saved": accepting does three or four
      // separate things and the reviewer needs to know which of them landed.
      const done = [`Enrolled into ${activation.batchName}`];
      if (activation.invoiceNumber) done.push(`invoice ${activation.invoiceNumber} sent`);
      if (activation.credentialsEmailed) done.push("login emailed");
      toast({ title: "Student accepted", description: `${done.join(" · ")}.`, variant: "success" });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't accept this submission");
    }
  }

  async function handleReject(): Promise<void> {
    if (!data) return;
    try {
      await reject.mutateAsync({ id: data.id, body: { ...(trimmedNotes ? { reviewNotes: trimmedNotes } : {}) } });
      toast({
        title: "Submission rejected",
        ...(data.email ? { description: `${data.email} has been emailed.` } : {}),
        variant: "success",
      });
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't reject this submission");
    }
  }

  const noBatches = !batchesQuery.isLoading && !batchesQuery.isError && (batches?.length ?? 0) === 0;

  return (
    <>
      <Drawer open={Boolean(submissionId)} onOpenChange={onOpenChange}>
        <DrawerContent title="Onboarding submission" size="lg" data-testid="onboarding-submission-drawer">
          <DrawerBody className="flex flex-col gap-5">
            {isLoading ? <p className="text-sm text-fg-muted">Loading…</p> : null}
            {isError ? <Alert tone="danger" title="Couldn't load this submission" /> : null}

            {data ? (
              <>
                <DetailGrid columns={2}>
                  <DetailRow label="Name">{data.fullName ?? "-"}</DetailRow>
                  <DetailRow label="Status">
                    <StatusChip
                      tone={submissionStatusTone(data.status)}
                      label={submissionStatusLabel(data.status)}
                      size="sm"
                    />
                  </DetailRow>
                  <DetailRow label="Email">{data.email ?? "-"}</DetailRow>
                  <DetailRow label="Phone">{data.phone ?? "-"}</DetailRow>
                  <DetailRow label="Program">{data.programTitle ?? "-"}</DetailRow>
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
                    <Textarea
                      label="Internal notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      helperText="Only staff see this. The student is never shown these notes. Not even in the rejection email."
                      data-testid="onboarding-notes-input"
                    />
                    {notesDirty && !decision ? (
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleSaveNotes}
                          loading={updateSubmission.isPending}
                          data-testid="onboarding-notes-save"
                        >
                          Save notes
                        </Button>
                      </div>
                    ) : null}

                    {settled ? (
                      <Alert tone="info" title="This student is already enrolled">
                        The decision can&apos;t be changed here. Withdraw their enrollment under Students if you need to
                        reverse it.
                      </Alert>
                    ) : null}

                    {decision === "accept" ? (
                      <div
                        className="flex flex-col gap-4 rounded-md border border-brand-500/40 bg-brand-500/5 p-4"
                        data-testid="onboarding-accept-panel"
                      >
                        <div>
                          <h3 className="text-sm font-semibold text-fg">Accept this student</h3>
                          <p className="mt-0.5 text-sm text-fg-muted">
                            They&apos;ll be enrolled into the batch you pick and emailed straight away.
                          </p>
                        </div>

                        {batchesQuery.isError ? (
                          <Alert tone="danger" title="Couldn't load the batches for this program" />
                        ) : noBatches ? (
                          <Alert tone="warning" title="No open batch for this program">
                            {data.programId
                              ? "Every cohort of this program is completed or archived. Create a batch under Batches, then accept this student."
                              : "This submission didn't capture a program, so there's no cohort to enrol into."}
                          </Alert>
                        ) : (
                          <Select
                            label="Batch"
                            value={batchId}
                            placeholder={batchesQuery.isLoading ? "Loading batches…" : "Choose a batch"}
                            onValueChange={setBatchId}
                            data-testid="onboarding-accept-batch"
                          >
                            {(batches ?? []).map((batch) => (
                              <SelectItem key={batch.id} value={batch.id}>
                                {batch.startDate
                                  ? `${batch.name} · starts ${new Date(batch.startDate).toLocaleDateString()}`
                                  : batch.name}
                              </SelectItem>
                            ))}
                          </Select>
                        )}

                        {/*
                          WHO THIS MEMBER BELONGS TO. Required, and sits beside the batch
                          because both are things only the reviewer knows.

                          Their payment lands in this person's individual report and in their
                          team's revenue. Before this field existed an onboarding member had
                          no owner at all, so their money showed up in the company total and
                          in nobody's individual one — a gap nothing on screen revealed,
                          because a number that is too small is not a number anyone queries.
                        */}
                        {staffQuery.isError ? (
                          <Alert tone="danger" title="Couldn't load the staff list" >
                            Reload the page and try again — an applicant can&apos;t be accepted without being tagged.
                          </Alert>
                        ) : (
                          <Select
                            label="Tagged to"
                            value={ownerUserId}
                            placeholder={staffQuery.isLoading ? "Loading staff…" : "Who brought them in?"}
                            onValueChange={setOwnerUserId}
                            helperText="Their payment counts towards this person and their team."
                            required
                            data-testid="onboarding-accept-owner"
                          >
                            {(taggableStaff ?? []).map((person) => (
                              <SelectItem key={person.id} value={person.id}>
                                {person.name}
                              </SelectItem>
                            ))}
                          </Select>
                        )}

                        {invoiceable ? (
                          <div className="flex flex-col gap-1">
                            <label className="flex items-start gap-2 text-sm text-fg">
                              <Checkbox
                                checked={recordPayment}
                                onCheckedChange={(checked) => setRecordPayment(checked === true)}
                                className="mt-0.5"
                                data-testid="onboarding-accept-record-payment"
                              />
                              <span>
                                Record their payment of{" "}
                                <span className="font-medium">{formatPaise(price, data.programCurrency)}</span> and
                                email the invoice
                              </span>
                            </label>
                            <p className="pl-6 text-xs text-fg-subtle">
                              Raises a GST invoice for the receipt they uploaded and sends it together with their login,
                              in one email. Untick for a scholarship seat, or if you&apos;ve already invoiced them.
                            </p>
                          </div>
                        ) : (
                          <Alert tone="info" title="No invoice will be raised">
                            {data.programId
                              ? "This program has no price set, so there's nothing to invoice. The student is still enrolled and emailed their login."
                              : "This submission has no program, so there's nothing to invoice."}
                          </Alert>
                        )}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : null}
          </DrawerBody>

          <DrawerFooter>
            {decision === "accept" ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setDecision(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleAccept}
                  loading={approve.isPending}
                  disabled={!batchId || !ownerUserId}
                  data-testid="onboarding-accept-confirm"
                >
                  Accept &amp; enrol
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                {canEdit && data && !settled ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setDecision("reject")}
                      data-testid="onboarding-reject"
                    >
                      <X className="size-4" aria-hidden="true" />
                      Reject
                    </Button>
                    <Button type="button" onClick={() => setDecision("accept")} data-testid="onboarding-accept">
                      <Check className="size-4" aria-hidden="true" />
                      Accept
                    </Button>
                  </>
                ) : null}
              </>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={decision === "reject"}
        onOpenChange={(open) => !open && setDecision(null)}
        title="Reject this submission?"
        // Says exactly what leaves the building. The notes line is here because "will the
        // student see what I typed?" is the question a reviewer is most likely to get wrong.
        description={
          <span className="flex flex-col gap-2">
            <span>
              {data?.email
                ? `We'll email ${data.email} to say we couldn't accept their application, and ask them to contact support.`
                : "This submission has no email address, so nobody will be notified. The decision is only recorded here."}
            </span>
            <span>
              Your internal notes are not included in that email. No student account is created and nothing is charged.
            </span>
          </span>
        }
        confirmLabel="Reject & notify"
        tone="danger"
        loading={reject.isPending}
        onConfirm={handleReject}
        data-testid="confirm-reject-onboarding-submission"
      />
    </>
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
    if (!url) return <span className="text-fg-subtle">Attachment unavailable, try reopening this submission.</span>;
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
  if (answer.value === null || answer.value === "") return <span className="text-fg-subtle">-</span>;
  // `whitespace-pre-line` so a multi-line textarea answer (e.g. the referrals question)
  // keeps the line breaks the student typed.
  return <span className="whitespace-pre-line">{answer.value}</span>;
}
