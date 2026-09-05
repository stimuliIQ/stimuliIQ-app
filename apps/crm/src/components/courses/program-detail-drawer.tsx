// Program detail drawer — profile fields + curriculum builder +
// publish/unpublish toggle with confirm (docs/03 §7.4). RBAC-aware via
// `courses.edit`/`courses.create` (Faculty = "author" per the §9 matrix —
// the API enforces who can actually mutate; this only hides affordances).
import * as React from "react";
import { Button, ConfirmDialog, Drawer, DrawerContent, DrawerBody, DrawerFooter, EmptyState, Input, Label, Skeleton, Switch, useToast } from "@repo/ui";
import { EnrollmentPaymentUrlSchema, type MeResponse } from "@repo/types";

import { useProgram, usePublishProgram, useUnpublishProgram, useSetProgramVisibility, useUpdateProgram } from "../../hooks/use-courses";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { formatPaiseAsInr } from "../../lib/money";
import { ProgramStatusChip } from "./program-status-chip";
import { ProgramFormDrawer } from "./program-form-drawer";
import { CurriculumBuilder } from "./curriculum-builder";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

interface ProgramDetailDrawerProps {
  programId: string | null;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

export function ProgramDetailDrawer({ programId, onOpenChange, me }: ProgramDetailDrawerProps): React.JSX.Element {
  const open = Boolean(programId);
  const { data: program, isLoading, isError, error, refetch } = useProgram(programId ?? undefined);
  const publishProgram = usePublishProgram();
  const unpublishProgram = useUnpublishProgram();
  const setVisibility = useSetProgramVisibility();
  // No dedicated /enrollment route like /visibility — `enrollmentEnabled` rides the
  // normal PATCH /crm/courses/:id partial update.
  const updateProgram = useUpdateProgram();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = React.useState(false);
  const [confirmUnpublishOpen, setConfirmUnpublishOpen] = React.useState(false);

  const permissions = getModulePermissions(me, "courses");
  // Video library uses `videolib.upload` (not `.create`) for ingest, so check the
  // exact keys rather than getModulePermissions' CRUD convenience bundle.
  const canViewVideos = hasPermission(me?.permissions, "videolib.view");
  const canManageVideos = hasPermission(me?.permissions, "videolib.upload");
  const canDeleteVideos = hasPermission(me?.permissions, "videolib.delete");

  const handlePublish = async () => {
    if (!program) return;
    try {
      await publishProgram.mutateAsync(program.id);
      toast({ title: "Program published", variant: "success" });
      setConfirmPublishOpen(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't publish program");
    }
  };

  const handleUnpublish = async () => {
    if (!program) return;
    try {
      await unpublishProgram.mutateAsync(program.id);
      toast({ title: "Program unpublished", variant: "success" });
      setConfirmUnpublishOpen(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't unpublish program");
    }
  };

  const handleToggleVisibility = async (next: boolean) => {
    if (!program) return;
    try {
      await setVisibility.mutateAsync({ id: program.id, isPublic: next });
      toast({ title: next ? "Now visible on the website" : "Hidden from the website", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update visibility");
    }
  };

  // Razorpay payment link — a text field with an explicit Save (not save-on-blur): a
  // half-typed URL must never go live on the website. Seeded from the loaded program and
  // re-seeded whenever a different program is opened or a save lands.
  const savedPaymentUrl = program?.enrollmentPaymentUrl ?? "";
  const [paymentUrl, setPaymentUrl] = React.useState(savedPaymentUrl);
  const [paymentUrlError, setPaymentUrlError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setPaymentUrl(savedPaymentUrl);
    setPaymentUrlError(null);
  }, [program?.id, savedPaymentUrl]);
  const paymentUrlDirty = paymentUrl.trim() !== savedPaymentUrl;

  const handleSavePaymentUrl = async () => {
    if (!program) return;
    const trimmed = paymentUrl.trim();
    let next: string | null = null;
    if (trimmed) {
      // Same schema the API validates against — the form cannot accept what the server rejects.
      const parsed = EnrollmentPaymentUrlSchema.safeParse(trimmed);
      if (!parsed.success) {
        setPaymentUrlError(parsed.error.issues[0]?.message ?? "Enter a valid https:// link");
        return;
      }
      next = parsed.data;
    }
    setPaymentUrlError(null);
    try {
      await updateProgram.mutateAsync({ id: program.id, body: { enrollmentPaymentUrl: next } });
      toast({
        title: next ? "Payment link saved" : "Payment link removed",
        description: next
          ? program.enrollmentEnabled
            ? "Enroll Now on the website now opens this link."
            : "It will be used once you switch enrollment on."
          : "Enroll Now on the website uses the built-in checkout again.",
        variant: "success",
      });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save payment link");
    }
  };

  const handleToggleEnrollment = async (next: boolean) => {
    if (!program) return;
    try {
      await updateProgram.mutateAsync({ id: program.id, body: { enrollmentEnabled: next } });
      toast({
        title: next ? "Enrollment opened" : "Enrollment closed",
        description: next
          ? "The website now shows the Enroll Now button for this program."
          : "The website now offers Book Free Slot only.",
        variant: "success",
      });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update enrollment");
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent title={program?.title ?? "Program"} description={program?.slug} size="xl" data-testid="program-detail-drawer">
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="program-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="program-detail-error"
                title="Couldn't load this program"
                description={queryErrorMessage(error, "Something went wrong fetching its details.")}
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="program-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !program ? (
              <EmptyState data-testid="program-detail-empty" title="No data" description="This program has no details to show." />
            ) : (
              <div className="flex flex-col gap-6">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-fg-muted">Status</dt>
                    <dd className="mt-1">
                      <ProgramStatusChip status={program.status} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Price</dt>
                    <dd className="mt-1 text-fg">{formatPaiseAsInr(program.pricePaise)}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Domain</dt>
                    <dd className="mt-1 text-fg">{program.domain}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Level</dt>
                    <dd className="mt-1 text-fg">{program.level}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Mode</dt>
                    <dd className="mt-1 text-fg">{program.mode}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Duration</dt>
                    <dd className="mt-1 text-fg">{program.durationWeeks} weeks</dd>
                  </div>
                  {program.summary ? (
                    <div className="col-span-2">
                      <dt className="text-fg-muted">Summary</dt>
                      <dd className="mt-1 text-fg">{program.summary}</dd>
                    </div>
                  ) : null}
                </dl>

                {/* Website visibility (marketing isPublic flag) — separate from the
                    publish status. The site lists a program only when BOTH published AND visible. */}
                <div className="rounded-md border border-border p-4" data-testid="program-visibility">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-fg">Visible on website</p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        Show this program on the public marketing site and the book-a-slot dropdown.
                        Also requires the status to be <span className="font-medium">Published</span>.
                      </p>
                    </div>
                    <Switch
                      checked={program.isPublic}
                      onCheckedChange={handleToggleVisibility}
                      disabled={!permissions.canEdit || setVisibility.isPending}
                      aria-label="Visible on website"
                    />
                  </div>
                  {program.isPublic && program.status !== "published" ? (
                    <p className="mt-2 text-xs text-warning" data-testid="program-visibility-hint">
                      Marked visible, but it won&apos;t appear on the site until you Publish it (status is {program.status}).
                    </p>
                  ) : null}
                </div>

                {/* Self-serve enrollment (enrollmentEnabled). Independent of visibility:
                    a program can be listed and browsable while its checkout is closed. */}
                <div className="rounded-md border border-border p-4" data-testid="program-enrollment">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-fg">Enrollment open</p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        Show the <span className="font-medium">Enroll Now</span> button on the website and
                        allow students to pay online. When off, the program is still browsable but only
                        offers <span className="font-medium">Book Free Slot</span>.
                      </p>
                    </div>
                    <Switch
                      checked={program.enrollmentEnabled}
                      onCheckedChange={handleToggleEnrollment}
                      disabled={!permissions.canEdit || updateProgram.isPending}
                      aria-label="Enrollment open"
                    />
                  </div>
                  {!program.enrollmentEnabled ? (
                    <p className="mt-2 text-xs text-fg-muted" data-testid="program-enrollment-hint">
                      Online checkout is closed. Staff can still enrol students manually from the CRM.
                    </p>
                  ) : null}

                  {/* Razorpay payment link (enrollmentPaymentUrl). Rides on the toggle above:
                      shown on the website only while enrollment is open, otherwise the in-app
                      checkout is used. Explicit Save so nothing half-typed goes live. */}
                  <div className="mt-4 border-t border-border pt-4" data-testid="program-payment-link">
                    <Label htmlFor="program-payment-url">Razorpay payment link</Label>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      Paste the payment link from your Razorpay dashboard. When enrollment is on,
                      the website&apos;s <span className="font-medium">Enroll Now</span> button opens
                      this link. Leave empty to use the built-in checkout.
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                      <div className="flex-1">
                        <Input
                          id="program-payment-url"
                          type="url"
                          inputMode="url"
                          placeholder="https://rzp.io/l/..."
                          value={paymentUrl}
                          onChange={(e) => {
                            setPaymentUrl(e.target.value);
                            setPaymentUrlError(null);
                          }}
                          disabled={!permissions.canEdit || updateProgram.isPending}
                          aria-invalid={paymentUrlError ? true : undefined}
                          aria-describedby={paymentUrlError ? "program-payment-url-error" : undefined}
                          data-testid="program-payment-url-input"
                        />
                        {paymentUrlError ? (
                          <p id="program-payment-url-error" role="alert" className="mt-1 text-xs text-danger">
                            {paymentUrlError}
                          </p>
                        ) : null}
                      </div>
                      {permissions.canEdit ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleSavePaymentUrl}
                          disabled={!paymentUrlDirty || updateProgram.isPending}
                          aria-busy={updateProgram.isPending || undefined}
                          data-testid="program-payment-url-save"
                        >
                          Save link
                        </Button>
                      ) : null}
                    </div>
                    {savedPaymentUrl ? (
                      <p className="mt-2 text-xs text-fg-muted" data-testid="program-payment-link-hint">
                        {program.enrollmentEnabled
                          ? "Enroll Now on the website opens this link."
                          : "Saved, but not shown on the website until enrollment is switched on."}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <h2 className="mb-2 text-sm font-semibold text-fg">Curriculum</h2>
                  <CurriculumBuilder
                    programId={program.id}
                    canEdit={permissions.canEdit}
                    canViewVideos={canViewVideos}
                    canManageVideos={canManageVideos}
                    canDeleteVideos={canDeleteVideos}
                  />
                </div>
              </div>
            )}
          </DrawerBody>
          {program ? (
            <DrawerFooter>
              {permissions.canEdit ? (
                <Button variant="secondary" onClick={() => setEditOpen(true)} data-testid="program-edit-button">
                  Edit
                </Button>
              ) : null}
              {permissions.canEdit ? (
                program.status === "published" ? (
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmUnpublishOpen(true)}
                    data-testid="program-unpublish-button"
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button onClick={() => setConfirmPublishOpen(true)} data-testid="program-publish-button">
                    Publish
                  </Button>
                )
              ) : null}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      {program ? <ProgramFormDrawer open={editOpen} onOpenChange={setEditOpen} program={program} /> : null}

      <ConfirmDialog
        open={confirmPublishOpen}
        onOpenChange={setConfirmPublishOpen}
        title="Publish this program?"
        description="The program becomes visible wherever published programs are surfaced (e.g. the marketing site, once P5 ships)."
        confirmLabel="Publish"
        loading={publishProgram.isPending}
        onConfirm={handlePublish}
        data-testid="program-publish-confirm"
      />
      <ConfirmDialog
        open={confirmUnpublishOpen}
        onOpenChange={setConfirmUnpublishOpen}
        title="Unpublish this program?"
        description="The program reverts to draft and stops being visible publicly."
        confirmLabel="Unpublish"
        tone="danger"
        loading={unpublishProgram.isPending}
        onConfirm={handleUnpublish}
        data-testid="program-unpublish-confirm"
      />
    </>
  );
}
