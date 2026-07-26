// Lead detail drawer — tabs: Overview (fields + stage move + reassign
// owner), Activity (ActivityTimeline + log-activity form), Tasks (this
// lead's task activities + SLA + complete), Bookings (this lead's
// bookings). Soft-delete/restore + Convert action live in the header,
// RBAC-gated. Mirrors order-detail-drawer.tsx's drawer-with-DataTable
// pattern, extended with Tabs (docs/03 §7.11/§7.12).
import * as React from "react";
import { Trash2, ArrowRightLeft, UserCog } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  ActivityTimeline,
  Select,
  SelectItem,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Input,
  useToast,
  type ActivityItem,
} from "@repo/ui";
import type { LeadStage, MeResponse } from "@repo/types";

import { useDeleteLead, useLead, useMoveLeadStage, useAssignLeadOwner } from "../../hooks/use-leads";
import { useActivitiesList } from "../../hooks/use-activities";
import { useBookingsList } from "../../hooks/use-bookings";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { LeadStageChip, LEAD_STAGE_COLUMNS } from "./lead-stage-chip";
import { LifecycleChip } from "../shared/lifecycle-chip";
import { LifecycleStepper } from "../shared/lifecycle-stepper";
import { BookingStatusChip } from "./booking-status-chip";
import { LogActivityForm } from "./log-activity-form";
import { TaskList } from "./task-list";
import { ConvertLeadDialog } from "./convert-lead-dialog";

interface LeadDetailDrawerProps {
  leadId: string | null;
  me: MeResponse | undefined;
  onOpenChange: (open: boolean) => void;
}

/** Format a Date as a `datetime-local` input value (local time, no seconds/TZ). */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadDetailDrawer({ leadId, me, onOpenChange }: LeadDetailDrawerProps): React.JSX.Element {
  const open = Boolean(leadId);
  const { data: lead, isLoading, isError, refetch } = useLead(leadId ?? undefined);
  const { toast } = useToast();

  const moveStage = useMoveLeadStage();
  const assignOwner = useAssignLeadOwner();
  const deleteLead = useDeleteLead();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [convertOpen, setConvertOpen] = React.useState(false);
  const [ownerInput, setOwnerInput] = React.useState("");
  // Follow-up scheduler: choosing "Follow-up" reveals a date/time picker instead of
  // moving immediately, so the callback is always scheduled (surfaces on the tasks/SLA queue).
  const [followUpAt, setFollowUpAt] = React.useState("");
  const [schedulingFollowUp, setSchedulingFollowUp] = React.useState(false);

  const activitiesQuery = useActivitiesList({ leadId: leadId ?? undefined, page: 1, pageSize: 50 });
  const tasksQuery = useActivitiesList({ leadId: leadId ?? undefined, type: "task", page: 1, pageSize: 50 });
  const bookingsQuery = useBookingsList({ leadId: leadId ?? undefined, page: 1, pageSize: 50 });

  const canEdit = hasPermission(me?.permissions, "leads.edit");
  const canDelete = hasPermission(me?.permissions, "leads.delete");
  const canConvert = hasPermission(me?.permissions, "leads.convert");

  React.useEffect(() => {
    setOwnerInput(lead?.ownerId ?? "");
  }, [lead?.ownerId]);

  function handleStageSelect(stage: LeadStage) {
    if (!lead) return;
    // Follow-up needs a callback date/time — reveal the scheduler instead of moving now.
    if (stage === "follow_up") {
      setSchedulingFollowUp(true);
      // Default the picker to the existing SLA due date, else 1 day out.
      const seed = lead.slaDueAt ? new Date(lead.slaDueAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      setFollowUpAt(toDatetimeLocalValue(seed));
      return;
    }
    setSchedulingFollowUp(false);
    void handleStageMove(stage);
  }

  async function handleStageMove(stage: LeadStage, followUpIso?: string) {
    if (!lead) return;
    if (stage === lead.stage) return;
    try {
      await moveStage.mutateAsync({
        id: lead.id,
        body: { stage, ...(followUpIso ? { followUpAt: followUpIso } : {}) },
      });
      toast({
        title: stage === "follow_up" ? "Follow-up scheduled" : "Stage updated",
        variant: "success",
      });
      setSchedulingFollowUp(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't move this lead's stage");
    }
  }

  async function handleScheduleFollowUp() {
    if (!followUpAt) return;
    await handleStageMove("follow_up", new Date(followUpAt).toISOString());
  }

  async function handleReassign() {
    if (!lead) return;
    try {
      await assignOwner.mutateAsync({ id: lead.id, body: { ownerId: ownerInput.trim() || null } });
      toast({ title: ownerInput.trim() ? "Owner reassigned" : "Owner unassigned", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't reassign the owner");
    }
  }

  async function handleDelete() {
    if (!lead) return;
    try {
      await deleteLead.mutateAsync(lead.id);
      toast({ title: "Lead deleted", description: "This was a soft delete — restorable from Audit Logs.", variant: "success" });
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't delete this lead");
    }
  }

  const activityItems: ActivityItem[] = (activitiesQuery.data?.items ?? []).map((activity) => ({
    id: activity.id,
    type: activity.type,
    actorName: activity.userName,
    timestamp: new Date(activity.createdAt),
    done: Boolean(activity.doneAt),
    dueAt: activity.dueAt ? new Date(activity.dueAt) : undefined,
    content:
      typeof activity.payload.body === "string"
        ? activity.payload.body
        : typeof activity.payload.notes === "string"
          ? activity.payload.notes
          : typeof activity.payload.description === "string"
            ? activity.payload.description
            : undefined,
  }));

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          title={lead ? lead.name : "Lead"}
          description={lead ? `${lead.phone}${lead.email ? ` · ${lead.email}` : ""}` : undefined}
          size="xl"
          data-testid="lead-detail-drawer"
        >
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="lead-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="lead-detail-error"
                title="Couldn't load this lead"
                description="Something went wrong fetching the lead details."
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="lead-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !lead ? (
              <EmptyState data-testid="lead-detail-empty" title="No data" description="This lead has no details to show." />
            ) : (
              <div className="flex flex-col gap-4">
                {/* The full journey path (lifecycle-redesign P2) — always visible above
                    the tabs so "how far along Lead → Certified" never needs a tab switch. */}
                <LifecycleStepper stage={lead.lifecycleStage} />
              <Tabs defaultValue="overview" data-testid="lead-detail-tabs">
                <TabsList aria-label="Lead record sections">
                  <TabsTrigger value="overview" data-testid="lead-tab-overview">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="activity" data-testid="lead-tab-activity">
                    Activity ({lead.activityCount})
                  </TabsTrigger>
                  <TabsTrigger value="tasks" data-testid="lead-tab-tasks">
                    Tasks
                  </TabsTrigger>
                  <TabsTrigger value="bookings" data-testid="lead-tab-bookings">
                    Bookings ({lead.bookingCount})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" data-testid="lead-tab-overview-content">
                  <div className="flex flex-col gap-6">
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-fg-muted">Phone</dt>
                        <dd className="mt-1">
                          <a
                            href={`tel:${lead.phone}`}
                            className="font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-testid="lead-detail-phone"
                          >
                            {lead.phone}
                          </a>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Email</dt>
                        <dd className="mt-1 text-fg">
                          {lead.email ? (
                            <a
                              href={`mailto:${lead.email}`}
                              className="font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {lead.email}
                            </a>
                          ) : (
                            "—"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Stage</dt>
                        <dd className="mt-1">
                          <LeadStageChip stage={lead.stage} />
                        </dd>
                      </div>
                      <div>
                        {/* Derived unified lifecycle stage (lifecycle-redesign P1) —
                            the same vocabulary the student directory speaks, so a lead
                            and the student it becomes read on one continuum. */}
                        <dt className="text-fg-muted">Lifecycle</dt>
                        <dd className="mt-1">
                          <LifecycleChip stage={lead.lifecycleStage} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Score</dt>
                        <dd className="mt-1 text-fg">{lead.score ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Program interest</dt>
                        <dd className="mt-1 text-fg">{lead.programInterestTitle ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Course (typed)</dt>
                        <dd className="mt-1 text-fg">{lead.courseInterest ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">College / University</dt>
                        <dd className="mt-1 text-fg">{lead.college ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Preferred language</dt>
                        <dd className="mt-1 text-fg">{lead.language ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Branch</dt>
                        <dd className="mt-1 text-fg">{lead.branchName ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Source</dt>
                        <dd className="mt-1 text-fg">{lead.source}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">SLA due</dt>
                        <dd className="mt-1 text-fg">{lead.slaDueAt ? new Date(lead.slaDueAt).toLocaleString() : "—"}</dd>
                      </div>
                      {lead.message ? (
                        <div className="col-span-2">
                          <dt className="text-fg-muted">Message</dt>
                          <dd className="mt-1 whitespace-pre-wrap text-fg">{lead.message}</dd>
                        </div>
                      ) : null}
                      {lead.utm ? (
                        <div className="col-span-2">
                          <dt className="text-fg-muted">UTM</dt>
                          <dd className="mt-1 text-fg">
                            {[lead.utm.source, lead.utm.medium, lead.utm.campaign].filter(Boolean).join(" / ") || "—"}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="text-fg-muted">Created</dt>
                        <dd className="mt-1 text-fg">{new Date(lead.createdAt).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Converted</dt>
                        <dd className="mt-1 text-fg">{lead.convertedStudentId ? "Yes" : "No"}</dd>
                      </div>
                    </dl>

                    {canEdit ? (
                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                          <ArrowRightLeft className="size-4" aria-hidden="true" />
                          Move stage
                        </span>
                        {/* key: Radix Select's trigger label doesn't reliably re-render
                            when the controlled value changes from outside (cache update
                            after a stage move) — remount it so it always shows lead.stage. */}
                        <Select
                          key={`stage-${lead.stage}`}
                          aria-label="Move to stage"
                          placeholder="Select stage"
                          value={lead.stage}
                          onValueChange={(value) => handleStageSelect(value as LeadStage)}
                          data-testid="lead-detail-stage-select"
                        >
                          {LEAD_STAGE_COLUMNS.map((col) => (
                            <SelectItem key={col.id} value={col.id}>
                              {col.title}
                            </SelectItem>
                          ))}
                        </Select>
                        {/* Follow-up scheduler — pick a callback date/time. */}
                        {schedulingFollowUp ? (
                          <div className="flex flex-col gap-2 rounded-md bg-surface/60 p-2" data-testid="lead-detail-followup-scheduler">
                            <label htmlFor="lead-followup-at" className="text-xs font-medium text-fg-muted">
                              Follow-up date &amp; time
                            </label>
                            <input
                              id="lead-followup-at"
                              type="datetime-local"
                              value={followUpAt}
                              onChange={(e) => setFollowUpAt(e.target.value)}
                              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid="lead-detail-followup-input"
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={handleScheduleFollowUp}
                                loading={moveStage.isPending}
                                disabled={!followUpAt}
                                data-testid="lead-detail-followup-submit"
                              >
                                Schedule follow-up
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setSchedulingFollowUp(false)}
                                data-testid="lead-detail-followup-cancel"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {canEdit ? (
                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                          <UserCog className="size-4" aria-hidden="true" />
                          Owner
                        </span>
                        <p className="text-xs text-fg-muted">Current: {lead.ownerName ?? "Unassigned"}</p>
                        <div className="flex gap-2">
                          <Input
                            aria-label="Owner user id"
                            placeholder="User id, or leave blank to unassign"
                            value={ownerInput}
                            onChange={(event) => setOwnerInput(event.target.value)}
                            wrapperClassName="flex-1"
                            data-testid="lead-detail-owner-input"
                          />
                          <Button onClick={handleReassign} loading={assignOwner.isPending} data-testid="lead-detail-reassign-submit">
                            Reassign
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent value="activity" data-testid="lead-tab-activity-content">
                  <div className="flex flex-col gap-4">
                    {canEdit ? <LogActivityForm leadId={lead.id} /> : null}
                    <ActivityTimeline items={activityItems} data-testid="lead-activity-timeline" />
                  </div>
                </TabsContent>

                <TabsContent value="tasks" data-testid="lead-tab-tasks-content">
                  <TaskList
                    tasks={tasksQuery.data?.items ?? []}
                    isLoading={tasksQuery.isLoading}
                    isError={tasksQuery.isError}
                    onRetry={() => tasksQuery.refetch()}
                    emptyTitle="No follow-up tasks for this lead"
                    data-testid="lead-task-list"
                  />
                </TabsContent>

                <TabsContent value="bookings" data-testid="lead-tab-bookings-content">
                  {bookingsQuery.isError ? (
                    <EmptyState
                      data-testid="lead-bookings-error"
                      title="Couldn't load bookings"
                      description="Something went wrong fetching bookings for this lead."
                      action={
                        <Button variant="secondary" onClick={() => bookingsQuery.refetch()} data-testid="lead-bookings-retry">
                          Try again
                        </Button>
                      }
                    />
                  ) : (bookingsQuery.data?.items ?? []).length === 0 ? (
                    <EmptyState
                      data-testid="lead-bookings-empty"
                      title="No bookings"
                      description="Demo/slot bookings for this lead will appear here."
                    />
                  ) : (
                    <ul className="flex flex-col gap-2" data-testid="lead-bookings-list">
                      {(bookingsQuery.data?.items ?? []).map((booking) => (
                        <li
                          key={booking.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                        >
                          <div>
                            <p className="text-fg">{booking.programTitle ?? "No program specified"}</p>
                            <p className="text-fg-muted">{new Date(booking.slotAt).toLocaleString()}</p>
                          </div>
                          <BookingStatusChip status={booking.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
              </div>
            )}
          </DrawerBody>
          {lead ? (
            <DrawerFooter>
              {canDelete ? (
                <Button
                  variant="destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                  data-testid="lead-detail-delete-button"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
              ) : null}
              {/* Hidden once converted — the action is one-shot (the dialog would only
                  say "already converted"); the Overview's "Converted: Yes" is the state. */}
              {canConvert && !lead.convertedStudentId ? (
                <Button onClick={() => setConvertOpen(true)} data-testid="lead-detail-convert-button">
                  Convert to student
                </Button>
              ) : null}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      {lead ? (
        <>
          <ConfirmDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            title="Delete this lead?"
            description="This soft-deletes the lead. It can be restored later from the Audit Logs."
            confirmLabel="Delete"
            tone="danger"
            loading={deleteLead.isPending}
            onConfirm={handleDelete}
            data-testid="lead-delete-confirm"
          />
          <ConvertLeadDialog
            lead={lead}
            open={convertOpen}
            onOpenChange={setConvertOpen}
            onConverted={() => {
              setConvertOpen(false);
            }}
          />
        </>
      ) : null}
    </>
  );
}
