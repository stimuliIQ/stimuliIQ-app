// Read one candidate's application and decide on it (ADR-0066).
//
// FOUR VERBS, NOT A STATUS PICKER — the same shape as the onboarding review drawer next
// door, for a stronger version of the same reason: three of these four send an email to a
// person outside the company, and one of them attaches a signed offer letter. A dropdown
// that fires an irreversible message on a mis-click is the wrong control, and it has
// nowhere to put what the shortlist and offer verbs each need (a round name, a PDF).
//
// EACH VERB CONFIRMS WHERE ITS EVIDENCE IS. Hold needs nothing and acts immediately.
// Shortlist and Offer need input, so they expand a panel INSIDE the drawer, with the resume
// and cover letter still on screen — a modal covering the thing you are judging is the
// wrong place to judge it. Reject needs no input, only a yes/no about an email going out,
// which is exactly what ConfirmDialog is.
//
// WHAT THE CANDIDATE NEVER SEES: `internalNotes`. Every panel that offers the field says so
// in as many words, because a reviewer typing "weak on the practical" needs to know beyond
// doubt that it is not about to be emailed.
//
// A DECIDED APPLICATION IS DONE. Once an offer or a rejection has gone out, the verbs
// disappear rather than being disabled-with-a-tooltip: the API refuses them anyway (the
// status is re-checked inside the UPDATE's WHERE), and showing dead buttons for an action
// nobody may take reads as a bug rather than as a decision.
import * as React from "react";
import { Check, Download, Mail, PauseCircle, Send, X } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DetailGrid,
  DetailRow,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  FileUpload,
  Input,
  StatusChip,
  type StatusChipTone,
  Textarea,
  statusTone,
  useToast,
} from "@repo/ui";
import type { CareerApplicationStatus } from "@repo/types";

import {
  requestOfferLetterUploadUrl,
  useCareerApplication,
  useHoldApplication,
  useOfferApplication,
  useRejectApplication,
  useResendAcknowledgement,
  useShortlistApplication,
} from "../../hooks/use-careers";
import { surfaceError } from "../../lib/surface-error";

/** Maps the workflow enum onto the canonical CRM tone vocabulary (crm-ui-consistency §2). */
export function applicationStatusTone(status: CareerApplicationStatus): StatusChipTone {
  switch (status) {
    case "selected":
      return statusTone("completed");
    case "rejected":
      return statusTone("rejected");
    case "shortlisted":
      return statusTone("in-progress");
    case "on_hold":
      return statusTone("on-hold");
    default:
      return statusTone("new");
  }
}

/** What staff call each state. */
export function applicationStatusLabel(status: CareerApplicationStatus): string {
  switch (status) {
    case "selected":
      return "Offer sent";
    case "rejected":
      return "Rejected";
    case "shortlisted":
      return "Next round";
    case "on_hold":
      return "On hold";
    default:
      return "New";
  }
}

/** A decided application is terminal — see the file header. */
function isDecided(status: CareerApplicationStatus): boolean {
  return status === "selected" || status === "rejected";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type ActivePanel = "none" | "shortlist" | "offer";

export interface CareerApplicationDrawerProps {
  applicationId: string | null;
  onOpenChange: (open: boolean) => void;
  canReview: boolean;
}

export function CareerApplicationDrawer({
  applicationId,
  onOpenChange,
  canReview,
}: CareerApplicationDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const { data: application, isLoading, isError } = useCareerApplication(applicationId);

  const hold = useHoldApplication();
  const shortlist = useShortlistApplication();
  const offer = useOfferApplication();
  const reject = useRejectApplication();
  const resendAck = useResendAcknowledgement();

  const [panel, setPanel] = React.useState<ActivePanel>("none");
  const [internalNotes, setInternalNotes] = React.useState("");
  const [roundName, setRoundName] = React.useState("");
  const [roundDetails, setRoundDetails] = React.useState("");
  const [offerMessage, setOfferMessage] = React.useState("");
  const [offerLetterKey, setOfferLetterKey] = React.useState<string | null>(null);
  const [confirmReject, setConfirmReject] = React.useState(false);

  // Reset every scratch field whenever a different candidate is opened. Without this, a note
  // typed about one applicant would still be sitting in the box for the next.
  React.useEffect(() => {
    setPanel("none");
    setInternalNotes(application?.internalNotes ?? "");
    setRoundName("");
    setRoundDetails("");
    setOfferMessage("");
    setOfferLetterKey(null);
    setConfirmReject(false);
  }, [applicationId, application?.internalNotes]);

  const isPending = hold.isPending || shortlist.isPending || offer.isPending || reject.isPending;
  const notes = internalNotes.trim() ? internalNotes.trim() : null;

  async function run(action: () => Promise<unknown>, success: string, failure: string): Promise<void> {
    try {
      await action();
      toast({ title: success, variant: "success" });
      setPanel("none");
    } catch (error) {
      surfaceError(toast, error, failure);
    }
  }

  async function handleHold(): Promise<void> {
    if (!application) return;
    await run(
      () => hold.mutateAsync({ id: application.id, body: { internalNotes: notes } }),
      "Candidate put on hold",
      "Couldn't put this candidate on hold",
    );
  }

  async function handleShortlist(): Promise<void> {
    if (!application || !roundName.trim() || !roundDetails.trim()) return;
    await run(
      () =>
        shortlist.mutateAsync({
          id: application.id,
          body: { roundName: roundName.trim(), details: roundDetails.trim(), internalNotes: notes },
        }),
      "Next-round email sent",
      "Couldn't move this candidate to the next round",
    );
  }

  async function handleOffer(): Promise<void> {
    if (!application || !offerLetterKey) return;
    await run(
      () =>
        offer.mutateAsync({
          id: application.id,
          body: {
            offerLetterStorageKey: offerLetterKey,
            // The API composes the recipient-facing attachment name itself; this is only
            // what was uploaded, kept so a failure message can name the right file.
            offerLetterFileName: "offer-letter.pdf",
            message: offerMessage.trim() || null,
            internalNotes: notes,
          },
        }),
      "Offer sent with the letter attached",
      "Couldn't send this offer",
    );
  }

  async function handleReject(): Promise<void> {
    if (!application) return;
    setConfirmReject(false);
    await run(
      () => reject.mutateAsync({ id: application.id, body: { internalNotes: notes } }),
      "Candidate notified",
      "Couldn't reject this application",
    );
  }

  const decided = application ? isDecided(application.status) : false;
  const showVerbs = canReview && application && !decided;

  return (
    <Drawer open={Boolean(applicationId)} onOpenChange={onOpenChange}>
      <DrawerContent
        title={application?.name ?? "Application"}
        description={application ? `${application.role} · applied ${formatDateTime(application.createdAt)}` : undefined}
        size="lg"
        data-testid="career-application-drawer"
      >
        <DrawerBody className="space-y-5">
          {isLoading ? <p className="text-sm text-fg-muted">Loading…</p> : null}
          {isError ? <Alert tone="danger">Couldn&apos;t load this application. Close the panel and try again.</Alert> : null}

          {application ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip
                  tone={applicationStatusTone(application.status)}
                  label={applicationStatusLabel(application.status)}
                />
                {application.decidedAt ? (
                  <span className="text-xs text-fg-subtle">
                    Decided {formatDateTime(application.decidedAt)}
                    {application.decidedByName ? ` by ${application.decidedByName}` : ""}
                  </span>
                ) : null}
              </div>

              {/*
                The acknowledgement is automatic, so its ABSENCE is the only thing worth
                surfacing — and it is worth surfacing loudly, because a candidate who was
                never acknowledged is sitting in silence believing we ignored them.
              */}
              {!application.acknowledgedAt ? (
                <Alert tone="warning" title="This candidate was never sent a confirmation">
                  The automatic &quot;thanks for applying&quot; email did not go out. They have had no reply from us at
                  all.
                  {canReview ? (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={resendAck.isPending}
                        onClick={() =>
                          run(
                            () => resendAck.mutateAsync(application.id),
                            "Confirmation sent",
                            "Couldn't send the confirmation",
                          )
                        }
                        data-testid="resend-acknowledgement"
                      >
                        <Mail className="size-3.5" aria-hidden="true" />
                        Send it now
                      </Button>
                    </div>
                  ) : null}
                </Alert>
              ) : null}

              <DetailGrid columns={2}>
                <DetailRow label="Email" value={<a href={`mailto:${application.email}`}>{application.email}</a>} />
                <DetailRow label="Phone" value={application.phone ?? "—"} />
                <DetailRow label="Applied for" value={application.role} />
                <DetailRow
                  label="Opening"
                  value={
                    application.jobOpening
                      ? application.jobOpening.title
                      : "No longer listed — this role has been deleted or closed"
                  }
                />
                <DetailRow label="Applied" value={formatDateTime(application.createdAt)} />
                <DetailRow label="Confirmation sent" value={formatDateTime(application.acknowledgedAt)} />
              </DetailGrid>

              {/*
                The title differs from `role` only when the opening was renamed after this
                person applied. Saying so explicitly beats showing two titles and leaving the
                reviewer to work out which is which.
              */}
              {application.jobOpeningTitle && application.jobOpeningTitle !== application.role ? (
                <Alert tone="info">
                  This role has since been renamed to <strong>{application.jobOpeningTitle}</strong>. The title above is
                  what it said when this person applied.
                </Alert>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {application.resumeDownloadUrl ? (
                  <Button variant="secondary" size="sm" asChild>
                    <a href={application.resumeDownloadUrl} target="_blank" rel="noreferrer" data-testid="download-resume">
                      <Download className="size-3.5" aria-hidden="true" />
                      Download resume
                    </a>
                  </Button>
                ) : (
                  <span className="text-sm text-fg-subtle">Resume unavailable right now — reopen to retry.</span>
                )}
                {application.offerLetterDownloadUrl ? (
                  <Button variant="secondary" size="sm" asChild>
                    <a
                      href={application.offerLetterDownloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="download-offer-letter"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      Offer letter sent
                    </a>
                  </Button>
                ) : null}
              </div>

              {application.coverLetter ? (
                <section>
                  <h3 className="text-sm font-semibold text-fg">Cover letter</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {application.coverLetter}
                  </p>
                </section>
              ) : null}

              {application.nextRoundName ? (
                <section className="rounded-md border border-border bg-surface p-4">
                  <h3 className="text-sm font-semibold text-fg">
                    What this candidate was told about the {application.nextRoundName}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                    {application.nextRoundDetails}
                  </p>
                </section>
              ) : null}

              {canReview ? (
                <Textarea
                  label="Internal notes"
                  rows={3}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  helperText="Only your colleagues see this. It is never shown or emailed to the candidate."
                  data-testid="application-internal-notes"
                />
              ) : null}

              {/* ── Shortlist panel ── */}
              {panel === "shortlist" ? (
                <section className="space-y-4 rounded-md border border-brand-500/30 bg-brand-50/40 p-4">
                  <h3 className="text-sm font-semibold text-fg">Move to the next round</h3>
                  <p className="text-xs text-fg-muted">
                    Both fields below go straight into the email this candidate receives. Write them as if you were
                    writing to them, because you are.
                  </p>
                  <Input
                    label="What is the next round called?"
                    required
                    value={roundName}
                    onChange={(e) => setRoundName(e.target.value)}
                    placeholder="Technical interview"
                    helperText='Name it for what it is — "Round 2" tells a candidate nothing.'
                    data-testid="shortlist-round-name"
                  />
                  <Textarea
                    label="What should they expect?"
                    required
                    rows={4}
                    value={roundDetails}
                    onChange={(e) => setRoundDetails(e.target.value)}
                    placeholder="A 45-minute video call with our academics lead. We'll email you two or three time slots this week — reply with whichever suits you."
                    helperText="Format, rough duration, who they'll meet, and how scheduling will happen."
                    data-testid="shortlist-details"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleShortlist}
                      loading={shortlist.isPending}
                      disabled={!roundName.trim() || !roundDetails.trim()}
                      data-testid="shortlist-submit"
                    >
                      <Send className="size-4" aria-hidden="true" />
                      Send and move forward
                    </Button>
                    <Button variant="ghost" onClick={() => setPanel("none")}>
                      Cancel
                    </Button>
                  </div>
                </section>
              ) : null}

              {/* ── Offer panel ── */}
              {panel === "offer" ? (
                <section className="space-y-4 rounded-md border border-success/30 bg-success/5 p-4">
                  <h3 className="text-sm font-semibold text-fg">Send the offer</h3>
                  <p className="text-xs text-fg-muted">
                    Upload the signed offer letter as a PDF. It is attached to the email the candidate receives, so they
                    keep a copy that never expires.
                  </p>
                  <FileUpload
                    requestUploadUrl={(file) => requestOfferLetterUploadUrl(application.id, file)}
                    onUploaded={(storageKey) => setOfferLetterKey(storageKey)}
                    onRemoved={() => setOfferLetterKey(null)}
                    acceptedTypes={["application/pdf"]}
                    maxBytes={10 * 1024 * 1024}
                    label="Offer letter (PDF)"
                    data-testid="offer-letter-upload"
                  />
                  <Textarea
                    label="Covering note (optional)"
                    rows={3}
                    value={offerMessage}
                    onChange={(e) => setOfferMessage(e.target.value)}
                    placeholder="We were really impressed by your teaching demo — the team is looking forward to having you."
                    helperText="Added above the standard offer wording. This one IS sent to the candidate."
                    data-testid="offer-message"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={handleOffer}
                      loading={offer.isPending}
                      disabled={!offerLetterKey}
                      data-testid="offer-submit"
                    >
                      <Check className="size-4" aria-hidden="true" />
                      Send offer
                    </Button>
                    <Button variant="ghost" onClick={() => setPanel("none")}>
                      Cancel
                    </Button>
                  </div>
                  {!offerLetterKey ? (
                    <p className="text-xs text-fg-subtle">
                      The offer cannot be sent without a letter — an offer email with nothing attached is worse than none
                      at all.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {decided ? (
                <Alert tone="neutral">
                  This application has been decided and the candidate has been emailed. Reopening it is a conversation to
                  have with them, not a status change here.
                </Alert>
              ) : null}
            </>
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          {showVerbs ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmReject(true)}
                disabled={isPending}
                data-testid="application-reject"
              >
                <X className="size-4 text-danger" aria-hidden="true" />
                Reject
              </Button>
              <Button variant="secondary" onClick={handleHold} loading={hold.isPending} data-testid="application-hold">
                <PauseCircle className="size-4" aria-hidden="true" />
                Hold
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPanel(panel === "shortlist" ? "none" : "shortlist")}
                disabled={isPending}
                data-testid="application-shortlist"
              >
                Next round
              </Button>
              <Button
                onClick={() => setPanel(panel === "offer" ? "none" : "offer")}
                disabled={isPending}
                data-testid="application-offer"
              >
                Send offer
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>

      <ConfirmDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title={`Reject ${application?.name ?? "this candidate"}?`}
        description="They will be emailed a short, polite decline straight away. Your internal notes are NOT included. This cannot be undone from here."
        confirmLabel="Reject and email"
        tone="danger"
        onConfirm={handleReject}
        loading={reject.isPending}
        data-testid="confirm-reject-application"
      />
    </Drawer>
  );
}
