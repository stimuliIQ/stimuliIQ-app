// Batch detail drawer — Overview + Roster tabs (docs/03 §7.5). Roster tab
// lists enrolled students (active+completed) via use-batches.ts'
// useBatchRoster, with enroll/move/withdraw actions wired to
// use-enrollments.ts. RBAC-aware: actions gated on batches.*/enrollments.*
// permissions — the API is the real enforcement point (CLAUDE.md §3.5), this
// only hides affordances the API would reject.
import * as React from "react";
import { ArrowRightLeft, UserMinus } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Select,
  SelectItem,
  Skeleton,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@repo/ui";
import type { BatchRosterEntry, MeResponse } from "@repo/types";

import {
  useAssignBatchFaculty,
  useBatch,
  useBatchRoster,
  useDeleteBatch,
  useRestoreBatch,
} from "../../hooks/use-batches";
import { useFacultyList } from "../../hooks/use-faculty";
import { useWithdrawEnrollment } from "../../hooks/use-enrollments";
import { getModulePermissions, hasPermission } from "../../lib/permissions";
import { BatchStatusChip } from "../shared/batch-status-chip";
import { BatchFormDrawer } from "./batch-form-drawer";
import { MoveEnrollmentDialog } from "./move-enrollment-dialog";
import { BatchMentorsPanel } from "./batch-mentors-panel";
import { BatchCompletionPanel } from "./batch-completion-panel";

const ROSTER_STATUS_TONE: Record<BatchRosterEntry["status"], "info" | "success" | "neutral" | "warning" | "danger"> = {
  active: "success",
  completed: "neutral",
  dropped: "warning",
};

const ROSTER_STATUS_LABEL: Record<BatchRosterEntry["status"], string> = {
  active: "Active",
  completed: "Completed",
  dropped: "Dropped",
};

interface BatchDetailDrawerProps {
  batchId: string | null;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

export function BatchDetailDrawer({ batchId, onOpenChange, me }: BatchDetailDrawerProps): React.JSX.Element {
  const open = Boolean(batchId);
  const { data: batch, isLoading, isError, refetch } = useBatch(batchId ?? undefined);
  const { data: roster, isLoading: rosterLoading, isError: rosterError, refetch: refetchRoster } = useBatchRoster(
    batchId ?? undefined,
  );
  const { data: facultyData } = useFacultyList({ page: 1, pageSize: 200, includeDeleted: false });

  const deleteBatch = useDeleteBatch();
  const restoreBatch = useRestoreBatch();
  const assignFaculty = useAssignBatchFaculty();
  const withdrawEnrollment = useWithdrawEnrollment();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState<{ enrollmentId: string; studentName: string } | null>(null);
  const [withdrawTarget, setWithdrawTarget] = React.useState<{ enrollmentId: string; studentName: string } | null>(
    null,
  );

  const batchPermissions = getModulePermissions(me, "batches");
  const canManageEnrollments =
    hasPermission(me?.permissions, "enrollments.create") || hasPermission(me?.permissions, "enrollments.edit");
  const canWithdraw = hasPermission(me?.permissions, "enrollments.delete");

  const handleDelete = async () => {
    if (!batch) return;
    try {
      await deleteBatch.mutateAsync(batch.id);
      toast({ title: "Batch removed", description: "You can restore it from the directory.", variant: "success" });
      setConfirmDeleteOpen(false);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't remove batch",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleRestore = async () => {
    if (!batch) return;
    try {
      await restoreBatch.mutateAsync(batch.id);
      toast({ title: "Batch restored", variant: "success" });
    } catch (error) {
      toast({
        title: "Couldn't restore batch",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleAssignFaculty = async (facultyId: string | undefined) => {
    if (!batch) return;
    try {
      await assignFaculty.mutateAsync({ id: batch.id, body: { facultyId: facultyId ?? null } });
      toast({ title: "Faculty updated", variant: "success" });
    } catch (error) {
      toast({
        title: "Couldn't assign faculty",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawTarget || !batch) return;
    try {
      await withdrawEnrollment.mutateAsync({ id: withdrawTarget.enrollmentId, batchId: batch.id });
      toast({ title: "Enrollment withdrawn", variant: "success" });
      setWithdrawTarget(null);
    } catch (error) {
      toast({
        title: "Couldn't withdraw enrollment",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const rosterColumns: Array<DataTableColumn<BatchRosterEntry>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName },
    { id: "studentEmail", header: "Email", cell: (row) => row.studentEmail },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip tone={ROSTER_STATUS_TONE[row.status]} label={ROSTER_STATUS_LABEL[row.status]} />,
    },
    { id: "progressPct", header: "Progress", cell: (row) => `${row.progressPct}%`, align: "right" },
    {
      id: "enrolledAt",
      header: "Enrolled",
      cell: (row) => new Date(row.enrolledAt).toLocaleDateString(),
      align: "right",
    },
  ];

  const faculty = facultyData?.items ?? [];

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          title={batch?.name ?? "Batch"}
          description={batch?.programTitle}
          size="xl"
          data-testid="batch-detail-drawer"
        >
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="batch-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="batch-detail-error"
                title="Couldn't load this batch"
                description="Something went wrong fetching the batch details."
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="batch-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !batch ? (
              <EmptyState data-testid="batch-detail-empty" title="No data" description="This batch has no details to show." />
            ) : (
              <Tabs defaultValue="overview">
                <TabsList aria-label="Batch record sections">
                  <TabsTrigger value="overview" data-testid="batch-tab-overview">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="roster" data-testid="batch-tab-roster">
                    Roster ({batch.enrolledCount})
                  </TabsTrigger>
                  <TabsTrigger value="mentors" data-testid="batch-tab-mentors">
                    Mentors
                  </TabsTrigger>
                  <TabsTrigger value="completion" data-testid="batch-tab-completion">
                    Completion
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="overview" data-testid="batch-tab-content-overview">
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-fg-muted">Status</dt>
                      <dd className="mt-1">
                        <BatchStatusChip status={batch.status} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Branch</dt>
                      <dd className="mt-1 text-fg">{batch.branchName}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Mode</dt>
                      <dd className="mt-1 text-fg capitalize">{batch.mode}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Capacity</dt>
                      <dd className="mt-1 text-fg">
                        {batch.enrolledCount} / {batch.capacity}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Start date</dt>
                      <dd className="mt-1 text-fg">{new Date(batch.startDate).toLocaleDateString()}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">End date</dt>
                      <dd className="mt-1 text-fg">{batch.endDate ? new Date(batch.endDate).toLocaleDateString() : "Open-ended"}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-fg-muted">Faculty</dt>
                      <dd className="mt-1">
                        {batchPermissions.canEdit ? (
                          <Select
                            aria-label="Assign faculty"
                            placeholder="Unassigned"
                            value={batch.facultyId ?? undefined}
                            onValueChange={(value) => handleAssignFaculty(value === "__none__" ? undefined : value)}
                            disabled={assignFaculty.isPending}
                            wrapperClassName="max-w-xs"
                            data-testid="batch-assign-faculty"
                          >
                            <SelectItem value="__none__">Unassigned</SelectItem>
                            {faculty.map((member) => (
                              <SelectItem key={member.id} value={member.id}>
                                {member.name}
                              </SelectItem>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-fg">{batch.facultyName ?? "Unassigned"}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {batch.deletedAt ? (
                    <Alert tone="danger" className="mt-4" data-testid="batch-deleted-banner">
                      This batch was removed on {new Date(batch.deletedAt).toLocaleDateString()}.
                    </Alert>
                  ) : null}
                </TabsContent>
                <TabsContent value="roster" data-testid="batch-tab-content-roster">
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-fg-muted">
                      Active and completed enrollments for this batch. Students are enrolled here automatically once they
                      pay for this program — assign the program and record payment from the student&apos;s profile.
                    </p>
                    {rosterError ? (
                      <EmptyState
                        data-testid="roster-error"
                        title="Couldn't load the roster"
                        description="Something went wrong fetching enrolled students."
                        action={
                          <Button variant="secondary" onClick={() => refetchRoster()} data-testid="roster-retry">
                            Try again
                          </Button>
                        }
                      />
                    ) : (
                      <DataTable
                        columns={rosterColumns}
                        rows={roster ?? []}
                        getRowId={(row) => row.enrollmentId}
                        loading={rosterLoading}
                        caption="Batch roster"
                        data-testid="roster-table"
                        emptyState={{
                          title: "No students enrolled yet",
                          description:
                            "Students appear here once they pay for this program's order — assign the program and record payment from the student's profile.",
                        }}
                        rowActions={
                          canManageEnrollments || canWithdraw
                            ? (row) => (
                                <div className="flex items-center justify-end gap-1">
                                  {canManageEnrollments && row.status === "active" ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Move ${row.studentName} to another batch`}
                                      onClick={() => setMoveTarget({ enrollmentId: row.enrollmentId, studentName: row.studentName })}
                                      data-testid="roster-move-button"
                                    >
                                      <ArrowRightLeft className="size-4" aria-hidden="true" />
                                    </Button>
                                  ) : null}
                                  {canWithdraw && row.status === "active" ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Withdraw ${row.studentName} from this batch`}
                                      onClick={() => setWithdrawTarget({ enrollmentId: row.enrollmentId, studentName: row.studentName })}
                                      data-testid="roster-withdraw-button"
                                    >
                                      <UserMinus className="size-4" aria-hidden="true" />
                                    </Button>
                                  ) : null}
                                </div>
                              )
                            : undefined
                        }
                      />
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="mentors" data-testid="batch-tab-content-mentors">
                  <BatchMentorsPanel batchId={batch.id} batchStatus={batch.status} me={me} />
                </TabsContent>
                <TabsContent value="completion" data-testid="batch-tab-content-completion">
                  <BatchCompletionPanel batchId={batch.id} me={me} />
                </TabsContent>
              </Tabs>
            )}
          </DrawerBody>
          {batch ? (
            <DrawerFooter>
              {batch.deletedAt ? (
                batchPermissions.canEdit ? (
                  <Button
                    variant="secondary"
                    onClick={handleRestore}
                    loading={restoreBatch.isPending}
                    data-testid="batch-restore-button"
                  >
                    Restore
                  </Button>
                ) : null
              ) : (
                <>
                  {batchPermissions.canDelete ? (
                    <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)} data-testid="batch-delete-button">
                      Delete
                    </Button>
                  ) : null}
                  {batchPermissions.canEdit ? (
                    <Button onClick={() => setEditOpen(true)} data-testid="batch-edit-button">
                      Edit
                    </Button>
                  ) : null}
                </>
              )}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      {batch ? <BatchFormDrawer open={editOpen} onOpenChange={setEditOpen} batch={batch} /> : null}
      {batch ? (
        <MoveEnrollmentDialog
          open={Boolean(moveTarget)}
          onOpenChange={(next) => !next && setMoveTarget(null)}
          enrollmentId={moveTarget?.enrollmentId ?? null}
          fromBatchId={batch.id}
          studentName={moveTarget?.studentName}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this batch?"
        description="This soft-deletes the record. You (or another admin) can restore it later."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteBatch.isPending}
        onConfirm={handleDelete}
        data-testid="batch-delete-confirm"
      />

      <ConfirmDialog
        open={Boolean(withdrawTarget)}
        onOpenChange={(next) => !next && setWithdrawTarget(null)}
        title="Withdraw this enrollment?"
        description={
          withdrawTarget ? `${withdrawTarget.studentName} will be marked as dropped from this batch.` : undefined
        }
        confirmLabel="Withdraw"
        tone="danger"
        loading={withdrawEnrollment.isPending}
        onConfirm={handleWithdraw}
        data-testid="roster-withdraw-confirm"
      />
    </>
  );
}
