// Mentor detail drawer — profile + expertise + read-only assigned-batches
// list (WS-1, docs/specs/phase-8-mentor.md). RBAC-aware Edit/Delete/Restore.
// AC-12: delete is blocked (409 MENTOR_HAS_ACTIVE_ASSIGNMENTS) while the
// mentor has any active batch_mentors row — surfaced as a clear message
// naming the blocking batch(es) from `ProblemDetails.errors[]`, not a raw
// error. Batch assignment/removal itself lives on the Batches module (WS-2,
// batch-mentors-panel.tsx) — this drawer's list is read-only.
import * as React from "react";
import { Github, Globe, Linkedin, Twitter, type LucideIcon } from "lucide-react";
import { ApiError } from "@repo/api-client";
import {
  Alert,
  Button,
  ConfirmDialog,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { MeResponse, MentorDetail } from "@repo/types";

import { useMentor, useDeleteMentor, useRestoreMentor } from "../../hooks/use-mentors";
import { getModulePermissions } from "../../lib/permissions";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";
import { BatchStatusChip } from "../shared/batch-status-chip";
import { MentorEngagementStatusChip } from "../shared/mentor-engagement-status-chip";
import { MentorFormDrawer } from "./mentor-form-drawer";

/** First initials (max 2) for the avatar fallback when no photo is set. */
function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((part) => /^[a-z]/i.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

const SOCIAL_META: Record<keyof NonNullable<MentorDetail["socialLinks"]>, { label: string; Icon: LucideIcon }> = {
  linkedin: { label: "LinkedIn", Icon: Linkedin },
  twitter: { label: "X / Twitter", Icon: Twitter },
  github: { label: "GitHub", Icon: Github },
  website: { label: "Website", Icon: Globe },
};

/** Social-link icon row (rendered only for the links the mentor actually has). */
function MentorSocialLinks({ links }: { links: MentorDetail["socialLinks"] }): React.JSX.Element | null {
  if (!links) return null;
  const keys = (Object.keys(SOCIAL_META) as Array<keyof typeof SOCIAL_META>).filter((k) => links[k]);
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1" data-testid="mentor-detail-social-links">
      {keys.map((k) => {
        const { label, Icon } = SOCIAL_META[k];
        return (
          <a
            key={k}
            href={links[k]!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="inline-flex size-8 items-center justify-center rounded-full border border-border text-fg-muted transition-colors hover:border-fg hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <Icon className="size-4" aria-hidden="true" />
          </a>
        );
      })}
    </div>
  );
}

interface MentorDetailDrawerProps {
  mentorId: string | null;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

export function MentorDetailDrawer({ mentorId, onOpenChange, me }: MentorDetailDrawerProps): React.JSX.Element {
  const open = Boolean(mentorId);
  const { data: mentor, isLoading, isError, error, refetch } = useMentor(mentorId ?? undefined);
  const deleteMentor = useDeleteMentor();
  const restoreMentor = useRestoreMentor();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  const permissions = getModulePermissions(me, "mentors");

  const handleDelete = async () => {
    if (!mentor) return;
    try {
      await deleteMentor.mutateAsync(mentor.id);
      toast({ title: "Mentor removed", description: "You can restore it from the directory.", variant: "success" });
      setConfirmDeleteOpen(false);
      onOpenChange(false);
    } catch (err) {
      // AC-12: MENTOR_HAS_ACTIVE_ASSIGNMENTS — name the blocking batch(es)
      // from ProblemDetails.errors[] (one entry per still-active
      // assignment; `message` carries the batch name, see
      // @repo/types/crm/mentors.schemas.ts's file header).
      if (err instanceof ApiError && err.problem.code === "MENTOR_HAS_ACTIVE_ASSIGNMENTS") {
        const batchNames = (err.problem.errors ?? []).map((e) => e.message).filter(Boolean);
        toast({
          title: "Can't remove this mentor yet",
          description:
            batchNames.length > 0
              ? `Still assigned to ${batchNames.join(", ")}. Remove the mentor from every batch first, then delete.`
              : "This mentor still has an active batch assignment. Remove them from every batch first.",
          variant: "destructive",
        });
        setConfirmDeleteOpen(false);
        return;
      }
      surfaceError(toast, err, "Couldn't remove mentor");
    }
  };

  const handleRestore = async () => {
    if (!mentor) return;
    try {
      await restoreMentor.mutateAsync(mentor.id);
      toast({ title: "Mentor restored", variant: "success" });
    } catch (err) {
      surfaceError(toast, err, "Couldn't restore mentor");
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          title={mentor?.fullName ?? "Mentor"}
          description={mentor?.email}
          size="lg"
          data-testid="mentor-detail-drawer"
        >
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="mentor-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="mentor-detail-error"
                title="Couldn't load this mentor"
                description={queryErrorMessage(error, "Something went wrong fetching their profile.")}
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="mentor-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !mentor ? (
              <EmptyState data-testid="mentor-detail-empty" title="No data" description="This mentor record has no details to show." />
            ) : (
              <div className="flex flex-col gap-6">
                {/* ── Profile header: photo + headline + institute·years + status + socials ── */}
                <div className="flex items-start gap-4">
                  <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface">
                    {mentor.photoUrl ? (
                      // Plain <img> — CRM is a Vite SPA (no next/image); cross-origin dev asset loads fine.
                      <img
                        src={mentor.photoUrl}
                        alt={mentor.fullName}
                        className="size-full object-cover"
                        data-testid="mentor-detail-photo"
                      />
                    ) : (
                      <span aria-hidden="true" className="text-xl font-semibold text-fg-muted" data-testid="mentor-detail-monogram">
                        {initialsOf(mentor.fullName) || "—"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    {mentor.title ? (
                      <p className="text-base font-semibold text-fg" data-testid="mentor-detail-title">
                        {mentor.title}
                      </p>
                    ) : null}
                    <p className="text-sm text-fg-muted">
                      {mentor.externalInstitute}
                      {typeof mentor.yearsExperience === "number" ? ` · ${mentor.yearsExperience}+ yrs experience` : ""}
                    </p>
                    <div className="pt-1">
                      <MentorEngagementStatusChip status={mentor.engagementStatus} />
                    </div>
                    <MentorSocialLinks links={mentor.socialLinks} />
                  </div>
                </div>

                {/* ── Bio ── */}
                {mentor.bio ? (
                  <div>
                    <h2 className="text-sm font-semibold text-fg">Bio</h2>
                    <p className="mt-1 whitespace-pre-line text-sm text-fg" data-testid="mentor-detail-bio">
                      {mentor.bio}
                    </p>
                  </div>
                ) : null}

                {/* ── Core hiring fields ── */}
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-fg-muted">Phone</dt>
                    <dd className="mt-1 text-fg">{mentor.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Joined</dt>
                    <dd className="mt-1 text-fg">{mentor.joinedAt ? new Date(mentor.joinedAt).toLocaleDateString() : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">External institute</dt>
                    <dd className="mt-1 text-fg">{mentor.externalInstitute}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Years of experience</dt>
                    <dd className="mt-1 text-fg">
                      {typeof mentor.yearsExperience === "number" ? `${mentor.yearsExperience} yrs` : "—"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-fg-muted">Expertise</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {mentor.expertise.length === 0 ? (
                        <span className="text-fg">—</span>
                      ) : (
                        mentor.expertise.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-fg"
                          >
                            {skill}
                          </span>
                        ))
                      )}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-fg-muted">Notes</dt>
                    <dd className="mt-1 whitespace-pre-line text-fg">{mentor.notes ?? "—"}</dd>
                  </div>
                </dl>

                {mentor.deletedAt ? (
                  <Alert tone="danger" data-testid="mentor-deleted-banner">
                    This mentor was removed on {new Date(mentor.deletedAt).toLocaleDateString()}.
                  </Alert>
                ) : null}

                <div>
                  <h2 className="text-sm font-semibold text-fg">Assigned batches</h2>
                  {mentor.assignedBatches.length === 0 ? (
                    <EmptyState
                      data-testid="mentor-assigned-batches-empty"
                      title="No batches assigned"
                      description="This mentor isn't assigned to any batch yet. Assign them from a batch's Mentors tab."
                    />
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2" data-testid="mentor-assigned-batches-list">
                      {mentor.assignedBatches.map((batch) => (
                        <li
                          key={batch.batchMentorId}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <div>
                            <p className="font-medium text-fg">
                              {batch.batchName}
                              {batch.isLead ? <StatusChip tone="info" label="Lead" className="ml-2 align-middle" /> : null}
                            </p>
                            <p className="text-fg-muted">{batch.programTitle}</p>
                          </div>
                          <BatchStatusChip status={batch.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </DrawerBody>
          {mentor ? (
            <DrawerFooter>
              {mentor.deletedAt ? (
                permissions.canEdit ? (
                  <Button
                    variant="secondary"
                    onClick={handleRestore}
                    loading={restoreMentor.isPending}
                    data-testid="mentor-restore-button"
                  >
                    Restore
                  </Button>
                ) : null
              ) : (
                <>
                  {permissions.canDelete ? (
                    <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)} data-testid="mentor-delete-button">
                      Delete
                    </Button>
                  ) : null}
                  {permissions.canEdit ? (
                    <Button onClick={() => setEditOpen(true)} data-testid="mentor-edit-button">
                      Edit
                    </Button>
                  ) : null}
                </>
              )}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      {mentor ? <MentorFormDrawer open={editOpen} onOpenChange={setEditOpen} mentor={mentor} /> : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this mentor?"
        description="This soft-deletes the record. You (or another admin) can restore it later. Blocked while the mentor has any active batch assignment."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMentor.isPending}
        onConfirm={handleDelete}
        data-testid="mentor-delete-confirm"
      />
    </>
  );
}
