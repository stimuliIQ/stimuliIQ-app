// Student detail drawer — Phase 9 Completion T37 (docs/plans/phase-9-
// completion.md): the "Available in a later phase" placeholder tabs are now
// filled with real data via `@repo/ui`'s DetailShell (Enrollments/Payments/
// Certificates/Tickets/Timeline). RBAC-aware: Edit/Delete/Restore
// only render if the API would accept them.
import * as React from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DetailShell,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Skeleton,
  useToast,
} from "@repo/ui";
import type { LifecycleStage, MeResponse } from "@repo/types";

import { useStudent, useDeleteStudent, useRestoreStudent, useResendCredentials } from "../../hooks/use-students";
import { getModulePermissions } from "../../lib/permissions";
import { StudentStatusChip } from "./student-status-chip";
import { LifecycleChip } from "../shared/lifecycle-chip";
import { LifecycleStepper } from "../shared/lifecycle-stepper";
import { StudentFormDrawer } from "./student-form-drawer";
import { RegisterStudentDialog } from "./register-student-dialog";
import { StudentEnrollmentsTab } from "./student-enrollments-tab";
import { StudentPaymentsTab } from "./student-payments-tab";
import { StudentAttendanceTab } from "./student-attendance-tab";
import { StudentCertificatesTab } from "./student-certificates-tab";
import { StudentTicketsTab } from "./student-tickets-tab";
import { StudentTimelineTab } from "./student-timeline-tab";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

interface StudentDetailDrawerProps {
  studentId: string | null;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

// Lifecycle stages at/after payment completion — the point where enrollment-time
// LMS provisioning has (or could have) issued credentials. `dropped` is included:
// a withdrawn student was enrolled, so an account exists to reissue if needed.
const LMS_PROVISIONED_STAGES: ReadonlySet<LifecycleStage> = new Set<LifecycleStage>([
  "payment_completed",
  "active_student",
  "learning_in_progress",
  "course_completed",
  "certified",
  "dropped",
]);

export function StudentDetailDrawer({ studentId, onOpenChange, me }: StudentDetailDrawerProps): React.JSX.Element {
  const open = Boolean(studentId);
  const { data: student, isLoading, isError, error, refetch } = useStudent(studentId ?? undefined);
  const deleteStudent = useDeleteStudent();
  const restoreStudent = useRestoreStudent();
  const resendCredentials = useResendCredentials();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [confirmResendOpen, setConfirmResendOpen] = React.useState(false);

  const permissions = getModulePermissions(me, "students");

  const handleDelete = async () => {
    if (!student) return;
    try {
      await deleteStudent.mutateAsync(student.id);
      toast({ title: "Student removed", description: "You can restore it from the directory.", variant: "success" });
      setConfirmDeleteOpen(false);
      onOpenChange(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't remove student");
    }
  };

  const handleRestore = async () => {
    if (!student) return;
    try {
      await restoreStudent.mutateAsync(student.id);
      toast({ title: "Student restored", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't restore student");
    }
  };

  const handleResendCredentials = async () => {
    if (!student) return;
    try {
      const result = await resendCredentials.mutateAsync(student.id);
      toast({ title: "Reset link sent", description: `A single-use password reset link was emailed to ${result.email}.`, variant: "success" });
      setConfirmResendOpen(false);
    } catch (error) {
      surfaceError(toast, error, "Couldn't send the reset link");
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          title={student?.name ?? "Student"}
          description={student?.email}
          // xl (not lg): the 360 has 6 tabs — at lg (672px) the tab row wraps
          // ("Timeline" dropped to a second line) and tables inside the tabs
          // were cramped. w-full still caps it on narrow screens.
          size="xl"
          data-testid="student-detail-drawer"
        >
          <DrawerBody>
            {isLoading ? (
              <div className="flex flex-col gap-3" data-testid="student-detail-loading">
                <Skeleton shape="line" />
                <Skeleton shape="line" />
                <Skeleton shape="block" />
              </div>
            ) : isError ? (
              <EmptyState
                data-testid="student-detail-error"
                title="Couldn't load this student"
                description={queryErrorMessage(error, "Something went wrong fetching their profile.")}
                action={
                  <Button variant="secondary" onClick={() => refetch()} data-testid="student-detail-retry">
                    Try again
                  </Button>
                }
              />
            ) : !student ? (
              <EmptyState data-testid="student-detail-empty" title="No data" description="This student record has no details to show." />
            ) : (
              <>
                <DetailShell
                  // No title/subtitle: DrawerContent above already renders the name +
                  // email. The derived lifecycle stage (lifecycle-redesign P1) leads —
                  // it answers "where is this student in the journey?" — with the coarse
                  // status kept alongside for continuity with the directory toggle.
                  meta={
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <LifecycleChip stage={student.lifecycleStage} />
                        <StudentStatusChip status={student.status} />
                      </div>
                      {/* The full journey path — the chip answers "what stage", this
                          answers "how far along the Lead → Certified spine". */}
                      <LifecycleStepper stage={student.lifecycleStage} />
                    </div>
                  }
                  tabsAriaLabel="Student record sections"
                  defaultValue="overview"
                  data-testid="student-detail-shell"
                  tabs={[
                    {
                      value: "overview",
                      label: "Overview",
                      content: (
                        <div className="flex flex-col gap-4" data-testid="student-tab-content-overview">
                          <dl className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <dt className="text-fg-muted">Course type</dt>
                              <dd className="mt-1 text-fg">{student.courseTypeLabel ?? "-"}</dd>
                            </div>
                            <div>
                              <dt className="text-fg-muted">Phone</dt>
                              <dd className="mt-1 text-fg">{student.phone ?? "-"}</dd>
                            </div>
                            <div>
                              <dt className="text-fg-muted">College</dt>
                              <dd className="mt-1 text-fg">{student.college ?? "-"}</dd>
                            </div>
                            <div>
                              <dt className="text-fg-muted">Year</dt>
                              <dd className="mt-1 text-fg">{student.year ?? "-"}</dd>
                            </div>
                            <div>
                              <dt className="text-fg-muted">City</dt>
                              <dd className="mt-1 text-fg">{student.city ?? "-"}</dd>
                            </div>
                            <div>
                              <dt className="text-fg-muted">Source</dt>
                              <dd className="mt-1 text-fg">{student.source ?? "-"}</dd>
                            </div>
                            <div>
                              <dt className="text-fg-muted">Created</dt>
                              <dd className="mt-1 text-fg">{new Date(student.createdAt).toLocaleDateString()}</dd>
                            </div>
                          </dl>
                          {student.deletedAt ? (
                            <Alert tone="danger" data-testid="student-deleted-banner">
                              This student was removed on {new Date(student.deletedAt).toLocaleDateString()}.
                            </Alert>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      value: "enrollments",
                      label: "Enrollments",
                      content: <StudentEnrollmentsTab studentId={student.id} me={me} />,
                    },
                    {
                      value: "payments",
                      label: "Payments",
                      content: <StudentPaymentsTab studentId={student.id} me={me} />,
                    },
                    {
                      // Between Payments and Certificates because that is the order of
                      // the journey: they paid, they turned up, they were certified.
                      value: "attendance",
                      label: "Attendance",
                      content: <StudentAttendanceTab studentId={student.id} />,
                    },
                    {
                      value: "certificates",
                      label: "Certificates",
                      content: <StudentCertificatesTab studentId={student.id} studentName={student.name} />,
                    },
                    {
                      value: "tickets",
                      label: "Tickets",
                      content: <StudentTicketsTab userId={student.userId} studentName={student.name} />,
                    },
                    {
                      value: "timeline",
                      label: "Timeline",
                      content: <StudentTimelineTab studentId={student.id} />,
                    },
                  ]}
                />
              </>
            )}
          </DrawerBody>
          {student ? (
            <DrawerFooter>
              {student.deletedAt ? (
                permissions.canEdit ? (
                  <Button
                    variant="secondary"
                    onClick={handleRestore}
                    loading={restoreStudent.isPending}
                    data-testid="student-restore-button"
                  >
                    Restore
                  </Button>
                ) : null
              ) : (
                <>
                  {permissions.canDelete ? (
                    <Button
                      variant="destructive"
                      onClick={() => setConfirmDeleteOpen(true)}
                      data-testid="student-delete-button"
                    >
                      Delete
                    </Button>
                  ) : null}
                  {permissions.canEdit ? (
                    <Button variant="secondary" onClick={() => setEditOpen(true)} data-testid="student-edit-button">
                      Edit
                    </Button>
                  ) : null}
                  {permissions.canEdit && student.status === "lead" ? (
                    // Lifecycle forward-action (lifecycle-redesign): a lead-status
                    // contact's next step is registration — surface it right here.
                    <Button onClick={() => setRegisterOpen(true)} data-testid="student-register-button">
                      Complete registration
                    </Button>
                  ) : null}
                  {permissions.canEdit && LMS_PROVISIONED_STAGES.has(student.lifecycleStage) ? (
                    // LMS access is a paid entitlement: credentials are first issued when
                    // payment completes (enrollment-time provisioning), so the resend
                    // action only appears from payment_completed onward — showing it for a
                    // payment-pending student would let staff hand out access early
                    // (resendCredentials rotates/activates unconditionally). Destructive
                    // from the student's POV (their current password stops working at once
                    // and every session is revoked), hence the confirm dialog below. The
                    // email carries a single-use reset LINK, never a password.
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmResendOpen(true)}
                      data-testid="student-resend-credentials-button"
                    >
                      Send password reset link
                    </Button>
                  ) : null}
                </>
              )}
            </DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>

      {student ? <StudentFormDrawer open={editOpen} onOpenChange={setEditOpen} student={student} /> : null}
      {student ? (
        <RegisterStudentDialog student={student} open={registerOpen} onOpenChange={setRegisterOpen} />
      ) : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this student?"
        description="This soft-deletes the record. You (or another admin) can restore it later."
        confirmLabel="Delete"
        tone="danger"
        loading={deleteStudent.isPending}
        onConfirm={handleDelete}
        data-testid="student-delete-confirm"
      />

      <ConfirmDialog
        open={confirmResendOpen}
        onOpenChange={setConfirmResendOpen}
        title="Send a password reset link?"
        description={
          student
            ? `This immediately invalidates ${student.name}'s current password and signs them out everywhere. ` +
              `A single-use link is emailed to ${student.email}, valid for 24 hours, for them to set a new password. ` +
              `No password is sent by email.`
            : undefined
        }
        confirmLabel="Send link"
        tone="danger"
        loading={resendCredentials.isPending}
        onConfirm={handleResendCredentials}
        data-testid="student-resend-credentials-confirm"
      />
    </>
  );
}
