// Faculty detail drawer — profile + expertise + read-only assigned-batches
// list (docs/03 §7.3). RBAC-aware Edit/Delete/Restore.
import * as React from "react";
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
  useToast,
} from "@repo/ui";
import type { MeResponse } from "@repo/types";

import {
  useFacultyMember,
  useDeleteFaculty,
  useRestoreFaculty,
  useResetFacultyPassword,
} from "../../hooks/use-faculty";
import { getModulePermissions } from "../../lib/permissions";
import { BatchStatusChip } from "../shared/batch-status-chip";
import { FacultyFormDrawer } from "./faculty-form-drawer";
import { queryErrorMessage } from "../../lib/surface-error";

interface FacultyDetailDrawerProps {
  facultyId: string | null;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

export function FacultyDetailDrawer({ facultyId, onOpenChange, me }: FacultyDetailDrawerProps): React.JSX.Element {
  const open = Boolean(facultyId);
  const { data: faculty, isLoading, isError, error, refetch } = useFacultyMember(facultyId ?? undefined);
  const deleteFaculty = useDeleteFaculty();
  const restoreFaculty = useRestoreFaculty();
  const resetPassword = useResetFacultyPassword();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [confirmResetPasswordOpen, setConfirmResetPasswordOpen] = React.useState(false);

  const permissions = getModulePermissions(me, "faculty");

  const handleDelete = async () => {
    if (!faculty) return;
    try {
      await deleteFaculty.mutateAsync(faculty.id);
      toast({ title: "Faculty member removed", description: "You can restore it from the directory.", variant: "success" });
      setConfirmDeleteOpen(false);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Couldn't remove faculty member",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleRestore = async () => {
    if (!faculty) return;
    try {
      await restoreFaculty.mutateAsync(faculty.id);
      toast({ title: "Faculty member restored", variant: "success" });
    } catch (error) {
      toast({
        title: "Couldn't restore faculty member",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleResetPassword = async () => {
    if (!faculty) return;
    try {
      const result = await resetPassword.mutateAsync(faculty.id);
      toast({ title: "Password reset", description: `New password sent to ${result.email}`, variant: "success" });
      setConfirmResetPasswordOpen(false);
    } catch (error) {
      toast({
        title: "Couldn't reset password",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent title={faculty?.name ?? "Faculty"} description={faculty?.email} size="lg" data-testid="faculty-detail-drawer">
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="faculty-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="faculty-detail-error"
                title="Couldn't load this faculty member"
                description={queryErrorMessage(error, "Something went wrong fetching their profile.")}
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="faculty-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !faculty ? (
              <EmptyState data-testid="faculty-detail-empty" title="No data" description="This faculty record has no details to show." />
            ) : (
              <div className="flex flex-col gap-6">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-fg-muted">Phone</dt>
                    <dd className="mt-1 text-fg">{faculty.phone ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Rating</dt>
                    <dd className="mt-1 text-fg">{faculty.rating ?? "-"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-fg-muted">Expertise</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {faculty.expertise.length === 0 ? (
                        <span className="text-fg">-</span>
                      ) : (
                        faculty.expertise.map((skill) => (
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
                    <dt className="text-fg-muted">Bio</dt>
                    <dd className="mt-1 text-fg">{faculty.bio ?? "-"}</dd>
                  </div>
                </dl>

                {faculty.deletedAt ? (
                  <Alert tone="danger" data-testid="faculty-deleted-banner">
                    This faculty member was removed on {new Date(faculty.deletedAt).toLocaleDateString()}.
                  </Alert>
                ) : null}

                <div>
                  <h2 className="text-sm font-semibold text-fg">Assigned batches</h2>
                  {faculty.assignedBatches.length === 0 ? (
                    <EmptyState
                      data-testid="faculty-assigned-batches-empty"
                      title="No batches assigned"
                      description="This faculty member isn't assigned to any batch yet."
                    />
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2" data-testid="faculty-assigned-batches-list">
                      {faculty.assignedBatches.map((batch) => (
                        <li
                          key={batch.id}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <div>
                            <p className="font-medium text-fg">{batch.name}</p>
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
          {faculty ? (
            <DrawerFooter>
              {faculty.deletedAt ? (
                permissions.canEdit ? (
                  <Button variant="secondary" onClick={handleRestore} loading={restoreFaculty.isPending} data-testid="faculty-restore-button">
                    Restore
                  </Button>
                ) : null
              ) : (
                <>
                  {permissions.canDelete ? (
                    <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)} data-testid="faculty-delete-button">
                      Delete
                    </Button>
                  ) : null}
                  {permissions.canEdit ? (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmResetPasswordOpen(true)}
                      data-testid="faculty-reset-password-button"
                    >
                      Reset password
                    </Button>
                  ) : null}
                  {permissions.canEdit ? (
                    <Button onClick={() => setEditOpen(true)} data-testid="faculty-edit-button">
                      Edit
                    </Button>
                  ) : null}
                </>
              )}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      {faculty ? <FacultyFormDrawer open={editOpen} onOpenChange={setEditOpen} faculty={faculty} /> : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this faculty member?"
        description="This soft-deletes the record. You (or another admin) can restore it later."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteFaculty.isPending}
        onConfirm={handleDelete}
        data-testid="faculty-delete-confirm"
      />

      <ConfirmDialog
        open={confirmResetPasswordOpen}
        onOpenChange={setConfirmResetPasswordOpen}
        title="Reset password?"
        description={
          faculty
            ? `This immediately invalidates ${faculty.name}'s current password and emails a new temporary one to ${faculty.email}. They'll be signed out and must set a new password next sign-in.`
            : undefined
        }
        confirmLabel="Reset password"
        tone="danger"
        loading={resetPassword.isPending}
        onConfirm={handleResetPassword}
        data-testid="faculty-reset-password-confirm"
      />
    </>
  );
}
