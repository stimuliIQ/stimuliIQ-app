// Certificate directory — Content > Certificates CRM view.
// Eligibility list + issue / revoke / reissue + verify link.
// RBAC-aware: issue only with certificates.issue, revoke only with
// certificates.revoke (UI hides affordances, API enforces).
// Revoke is a destructive action — always gated by RevokeCertificateDialog
// which requires a reason (ConfirmDialog pattern with extra input, AC-G1).
//
// BATCH-FIRST (2026-08-10): certification is cohort work, so the page opens on
// CertificateBatchList and this per-student table renders only once a batch is
// picked (`?batchId=` on the route, so a drilled-in view is linkable and the
// browser Back button works). The Batch/Program columns are gone from the table
// — inside one cohort they repeated the same value on every row, and the context
// line under the header carries them instead.
import * as React from "react";
import { ArrowLeft, ExternalLink, Eye } from "lucide-react";
import {
  Alert,
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectItem,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { EligibilityBatchSummary, EligibilityListItem, MeResponse } from "@repo/types";

import {
  useEligibilityList,
  useEligibilityDetail,
  useRecommendCertificate,
  useReissueCertificate,
} from "../../hooks/use-certificates";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { EligibilityGate } from "./eligibility-chip";
import { IssueCertificateDialog } from "./issue-certificate-dialog";
import { RevokeCertificateDialog } from "./revoke-certificate-dialog";
import { BulkIssueDialog } from "./bulk-issue-dialog";
import { CertificateBatchList } from "./certificate-batch-list";
import { CertTemplateSpecimenDrawer } from "./cert-template-specimen-drawer";
import { CertificatePreviewDialog } from "./certificate-preview-dialog";
import { certificateVerifyUrl } from "../../lib/public-urls";
import { queryErrorMessage } from "../../lib/surface-error";

interface CertificateDirectoryProps {
  me: MeResponse | undefined;
  /** The cohort being reviewed (`?batchId=`); null shows the batch landing table. */
  batchId: string | null;
  onBatchChange: (batchId: string | null) => void;
}

/**
 * The certificate serial, click-to-copy.
 *
 * An identifier you cannot get out of the screen is barely an identifier — the whole point
 * of the serial is that somebody reads it to a student or pastes it into the verify form.
 * Monospace and tabular so a column of them lines up and a mistyped character is visible.
 *
 * A `<button>` rather than a bare span: it is genuinely actionable, so it has to be
 * reachable by keyboard and announced as a control.
 */
function CertificateSerial({ serial }: { serial: string }): React.JSX.Element {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="font-mono text-[11px] tabular-nums text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Copy certificate ID"
      aria-label={`Copy certificate ID ${serial}`}
      onClick={async (e) => {
        // The row itself opens the eligibility breakdown; copying an id is not that.
        e.stopPropagation();
        await navigator.clipboard.writeText(serial);
        toast({ title: "Certificate ID copied", description: serial, variant: "success" });
      }}
      data-testid={`certificate-serial-${serial}`}
    >
      {serial}
    </button>
  );
}

export function CertificateDirectory({
  me,
  batchId,
  onBatchChange,
}: CertificateDirectoryProps): React.JSX.Element {
  const canIssue = hasPermission(me?.permissions, "certificates.issue");
  const canRevoke = hasPermission(me?.permissions, "certificates.revoke");
  const canRecommend = hasPermission(me?.permissions, "certificates.recommend");

  const [search, setSearch] = React.useState("");
  const [eligibleFilter, setEligibleFilter] = React.useState<boolean | undefined>(undefined);
  const [hasRecommendation, setHasRecommendation] = React.useState<boolean | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const [issueTarget, setIssueTarget] = React.useState<{ enrollmentId: string; studentName: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<{
    certificateId: string;
    studentName: string;
    certUid: string | null;
  } | null>(null);
  const [previewTarget, setPreviewTarget] = React.useState<{
    certificateId: string;
    studentName: string;
    programTitle: string;
    revoked: boolean;
  } | null>(null);
  const [bulkIssueOpen, setBulkIssueOpen] = React.useState(false);
  const [specimenOpen, setSpecimenOpen] = React.useState(false);
  // Remembered from the batch row that was clicked, so the context line can name
  // the cohort without a second fetch. A cold `?batchId=` link has no memory —
  // hence the fallback to the first loaded row below.
  const [openedBatch, setOpenedBatch] = React.useState<EligibilityBatchSummary | null>(null);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;
  const { toast } = useToast();

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, eligibleFilter, hasRecommendation]);

  // Switching cohorts resets everything scoped to the previous one: the page, the
  // student-name search (it named one person in the batch just left), and above all
  // the selection, whose enrollment ids belong to the old batch and would otherwise
  // be bulk-issued from a cohort the user is no longer looking at. The eligibility /
  // recommended dropdowns deliberately persist — those are how a reviewer works,
  // not something about one batch.
  React.useEffect(() => {
    setPage(1);
    setSearch("");
    setSelectedIds(new Set());
    setSelectedEnrollmentId(null);
  }, [batchId]);

  const { data, isLoading, isError, error, refetch, isFetching } = useEligibilityList(
    {
      page,
      pageSize,
      batchId: batchId ?? undefined,
      search: debouncedSearch || undefined,
      eligible: eligibleFilter,
      hasRecommendation,
    },
    { enabled: Boolean(batchId) },
  );

  // Only trust the remembered row while it still describes the batch in the URL —
  // editing `?batchId=` by hand must not leave the previous cohort's name on screen.
  const contextBatch = openedBatch?.batchId === batchId ? openedBatch : null;
  const firstRow = data?.items[0];
  // The row the breakdown panel is describing. Read from the list already in hand rather
  // than another fetch: the detail endpoint returns the eligibility gates, not the
  // certificate, so the id lives here.
  const selectedRow = (data?.items ?? []).find((row) => row.enrollmentId === selectedEnrollmentId) ?? null;
  const batchName = contextBatch?.batchName ?? firstRow?.batchName ?? null;
  const programTitle = contextBatch?.programTitle ?? firstRow?.programTitle ?? null;

  const handleOpenBatch = (batch: EligibilityBatchSummary) => {
    setOpenedBatch(batch);
    onBatchChange(batch.batchId);
  };

  const handleBackToBatches = () => {
    setOpenedBatch(null);
    onBatchChange(null);
  };

  const {
    data: eligibilityDetail,
    isLoading: eligDetailLoading,
  } = useEligibilityDetail(selectedEnrollmentId ?? undefined);

  const recommendCertificate = useRecommendCertificate();
  const reissueCertificate = useReissueCertificate();

  const handleRecommend = async (enrollmentId: string, studentName: string) => {
    try {
      await recommendCertificate.mutateAsync({
        enrollmentId,
        body: { note: `Recommended by ${me?.user.email ?? "faculty"}` },
      });
      toast({
        title: "Recommendation recorded",
        description: `${studentName} flagged for certificate issuance.`,
        variant: "success",
      });
    } catch (error) {
      const description = queryErrorMessage(error);
      toast({ title: "Couldn't record recommendation", description, variant: "destructive" });
    }
  };

  const handleReissue = async (enrollmentId: string, studentName: string) => {
    try {
      await reissueCertificate.mutateAsync({ enrollmentId, body: {} });
      toast({
        title: "Certificate reissued",
        description: `New certificate generated for ${studentName}. Old cert UID is now invalid.`,
        variant: "success",
      });
    } catch (error) {
      const description = queryErrorMessage(error);
      toast({ title: "Couldn't reissue certificate", description, variant: "destructive" });
    }
  };

  const columns: Array<DataTableColumn<EligibilityListItem>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName, sortable: true },
    {
      id: "completion",
      header: "Completion",
      cell: (row) => (
        <span
          className={
            row.eligibility.reasons.completionPassed
              ? "text-success font-medium text-sm"
              : "text-danger font-medium text-sm"
          }
        >
          {row.eligibility.reasons.completionPct}%
          <span className="sr-only">
            {row.eligibility.reasons.completionPassed ? ", passed" : ", below 90% threshold"}
          </span>
        </span>
      ),
      align: "right",
    },
    // The status columns are narrow; `whitespace-nowrap` keeps two-word labels like
    // "Not eligible" on ONE line instead of breaking mid-chip and blowing up row height.
    {
      id: "assessments",
      header: "Assessments",
      cell: (row) => (
        <StatusChip
          size="sm"
          className="whitespace-nowrap"
          tone={row.eligibility.reasons.requiredAssessmentsPassed ? "success" : "danger"}
          label={row.eligibility.reasons.requiredAssessmentsPassed ? "Passed" : "Pending"}
        />
      ),
    },
    {
      id: "project",
      header: "Project",
      cell: (row) => (
        <StatusChip
          size="sm"
          className="whitespace-nowrap"
          tone={row.eligibility.reasons.finalProjectApproved ? "success" : "danger"}
          label={row.eligibility.reasons.finalProjectApproved ? "Approved" : "Pending"}
        />
      ),
    },
    {
      id: "eligibility",
      header: "Eligible",
      cell: (row) => (
        <StatusChip
          size="sm"
          className="whitespace-nowrap"
          tone={row.eligibility.eligible ? "success" : "neutral"}
          label={row.eligibility.eligible ? "Eligible" : "Not eligible"}
        />
      ),
    },
    {
      id: "certificateStatus",
      header: "Certificate",
      cell: (row) =>
        row.certificateStatus ? (
          <div className="flex flex-col items-start gap-1">
            <StatusChip
              size="sm"
              className="whitespace-nowrap"
              tone={row.certificateStatus === "valid" ? "success" : "danger"}
              label={row.certificateStatus === "valid" ? "Issued" : "Revoked"}
            />
            {/* THE SERIAL, not the internal uuid.

                A certificate has three identifiers and only one of them belongs on screen:
                `certificateId` is a database uuid nobody quotes, `certUid` is the long
                HMAC-signed string behind the QR link (unguessable by design, and unreadable),
                and `serial` — STMQ-YYYY-XXXX-XXXX — is the short one built to be read off a
                printed certificate and typed into the verify form.

                Shown even on a REVOKED row: "which certificate was revoked?" is exactly the
                question somebody asks when a student rings up, and hiding the id then would
                make the row useless at the one moment it matters. */}
            {row.serial ? <CertificateSerial serial={row.serial} /> : null}
          </div>
        ) : (
          <span className="whitespace-nowrap text-xs text-fg-muted">Not issued</span>
        ),
    },
    {
      id: "actions",
      header: "",
      // flex-nowrap + shrink-0 children: Revoke/Verify sat side by side in a cramped
      // cell and wrapped on top of each other at narrower widths.
      cell: (row) => (
        <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
          {/* View the document itself — before revoking or reissuing, look at it. */}
          {row.certificateId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewTarget({
                  certificateId: row.certificateId as string,
                  studentName: row.studentName,
                  programTitle: row.programTitle,
                  revoked: row.certificateStatus === "revoked",
                });
              }}
              aria-label={`View the certificate issued to ${row.studentName}`}
              data-testid={`view-certificate-button-${row.enrollmentId}`}
            >
              <Eye className="mr-1 size-3.5" aria-hidden="true" />
              View
            </Button>
          ) : null}
          {/* Faculty recommend (not issue) */}
          {canRecommend && !row.eligibility.recommendedAt && !row.certificateStatus ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                void handleRecommend(row.enrollmentId, row.studentName);
              }}
              disabled={recommendCertificate.isPending}
              aria-label={`Recommend ${row.studentName} for certificate`}
              data-testid={`recommend-button-${row.enrollmentId}`}
            >
              Recommend
            </Button>
          ) : null}

          {/* Issue — only if eligible and no valid cert */}
          {canIssue && row.eligibility.eligible && !row.certificateStatus ? (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIssueTarget({ enrollmentId: row.enrollmentId, studentName: row.studentName });
              }}
              aria-label={`Issue certificate for ${row.studentName}`}
              data-testid={`issue-button-${row.enrollmentId}`}
            >
              Issue
            </Button>
          ) : null}

          {/* Revoke — only for valid certs */}
          {canRevoke && row.certificateStatus === "valid" && row.certificateId ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setRevokeTarget({
                  certificateId: row.certificateId as string,
                  studentName: row.studentName,
                  certUid: row.certUid,
                });
              }}
              aria-label={`Revoke certificate for ${row.studentName}`}
              data-testid={`revoke-button-${row.enrollmentId}`}
            >
              Revoke
            </Button>
          ) : null}

          {/* Reissue — only for revoked certs */}
          {canIssue && row.certificateStatus === "revoked" && row.enrollmentId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                void handleReissue(row.enrollmentId, row.studentName);
              }}
              disabled={reissueCertificate.isPending}
              aria-label={`Reissue certificate for ${row.studentName}`}
              data-testid={`reissue-button-${row.enrollmentId}`}
            >
              Reissue
            </Button>
          ) : null}

          {/* Public verify link */}
          {row.certUid ? (
            <a
              href={certificateVerifyUrl(row.certUid)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Open public verification link for ${row.studentName}`}
              data-testid={`verify-link-${row.enrollmentId}`}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              Verify
            </a>
          ) : null}
        </div>
      ),
    },
  ];

  const errorState = (
    <EmptyState
      data-testid="certificates-error"
      title="Couldn't load eligibility list"
      description={queryErrorMessage(error, "Something went wrong fetching certificate eligibility data.")}
      action={
        <Button variant="secondary" onClick={() => refetch()} data-testid="certificates-retry">
          Try again
        </Button>
      }
    />
  );

  const studentTable = (
    <>
      <DataFilterBar data-testid="certificates-filter-bar">
        <Input
          label="Search"
          placeholder="Student name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="w-56"
          data-testid="certificates-search-input"
        />
        <Select
          label="Eligibility"
          placeholder="All"
          value={
            eligibleFilter === undefined
              ? undefined
              : eligibleFilter
                ? "eligible"
                : "not-eligible"
          }
          onValueChange={(value) => {
            if (value === "__all__") setEligibleFilter(undefined);
            else setEligibleFilter(value === "eligible");
          }}
          wrapperClassName="w-40"
          data-testid="certificates-eligible-filter"
        >
          <SelectItem value="__all__">All</SelectItem>
          <SelectItem value="eligible">Eligible</SelectItem>
          <SelectItem value="not-eligible">Not eligible</SelectItem>
        </Select>
        <Select
          label="Recommended"
          placeholder="All"
          value={
            hasRecommendation === undefined ? undefined : hasRecommendation ? "yes" : "no"
          }
          onValueChange={(value) => {
            if (value === "__all__") setHasRecommendation(undefined);
            else setHasRecommendation(value === "yes");
          }}
          wrapperClassName="w-40"
          data-testid="certificates-recommended-filter"
        >
          <SelectItem value="__all__">All</SelectItem>
          <SelectItem value="yes">Recommended</SelectItem>
          <SelectItem value="no">Not recommended</SelectItem>
        </Select>
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.enrollmentId}
        loading={isLoading || isFetching}
        onRowClick={(row) =>
          setSelectedEnrollmentId(
            row.enrollmentId === selectedEnrollmentId ? null : row.enrollmentId,
          )
        }
        selection={
          canIssue
            ? { selectedIds, onSelectionChange: setSelectedIds, getRowId: (row) => row.enrollmentId }
            : undefined
        }
        pagination={{
          page,
          pageSize,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No students found",
          description: "Try adjusting your filters.",
        }}
        caption="Certificate eligibility list"
        data-testid="certificates-table"
      />

      {/* Eligibility detail panel */}
      {selectedEnrollmentId ? (
        <div
          className="flex flex-col gap-3 rounded-md border border-border p-4"
          data-testid="eligibility-detail-panel"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-fg">Eligibility breakdown</h2>
              {/* The selected student's certificate ID, once one exists. Repeated from the
                  table row on purpose: this panel is where somebody lands when they are
                  answering a question about ONE student, and making them close it and hunt
                  back up the row for the id is the sort of small friction that gets solved
                  by writing the number on a sticky note. */}
              {selectedRow?.serial ? (
                <span className="inline-flex items-baseline gap-1.5 text-xs text-fg-muted">
                  <span>Certificate ID</span>
                  <CertificateSerial serial={selectedRow.serial} />
                </span>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedEnrollmentId(null)}
              aria-label="Close eligibility panel"
              data-testid="eligibility-panel-close"
            >
              Close
            </Button>
          </div>

          {eligDetailLoading ? (
            <div className="flex flex-col gap-2" data-testid="eligibility-detail-loading">
              <Skeleton shape="line" />
              <Skeleton shape="line" />
              <Skeleton shape="line" />
            </div>
          ) : !eligibilityDetail ? null : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <EligibilityGate
                  passed={eligibilityDetail.reasons.completionPassed}
                  label="Course completion"
                  detail={`${eligibilityDetail.reasons.completionPct}% (requires ≥ 90%)`}
                />
                <EligibilityGate
                  passed={eligibilityDetail.reasons.requiredAssessmentsPassed}
                  label="Required assessments"
                  detail={
                    eligibilityDetail.reasons.requiredAssessmentsPassed
                      ? "All required assessments passed"
                      : "One or more required assessments not passed"
                  }
                />
                <EligibilityGate
                  passed={eligibilityDetail.reasons.finalProjectApproved}
                  label="Final project"
                  detail={
                    eligibilityDetail.reasons.finalProjectApproved
                      ? "All milestones reviewed"
                      : "Final project not yet fully reviewed"
                  }
                />
              </div>

              {eligibilityDetail.recommendedAt ? (
                <p className="text-xs text-fg-muted">
                  Recommended for issuance on{" "}
                  {new Date(eligibilityDetail.recommendedAt).toLocaleDateString()}
                </p>
              ) : null}

              <Alert
                tone={eligibilityDetail.eligible ? "success" : "neutral"}
                role="status"
                aria-live="polite"
              >
                {eligibilityDetail.eligible
                  ? "Student is eligible for certificate issuance."
                  : "Student is not yet eligible. Clear all three gates to proceed."}
              </Alert>
            </div>
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <div className="space-y-4 md:space-y-5" data-testid="certificates-directory">
      <PageHeader
        title="Certificates"
        description={
          batchId
            ? "Eligibility breakdown per student in this batch. Issue, revoke, and reissue certificates."
            : "Pick a batch to see its students, their eligibility gates, and issue certificates."
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setSpecimenOpen(true)} data-testid="certificates-template-specimen-button">
              <Eye className="size-4" aria-hidden="true" />
              Preview certificate
            </Button>
            {batchId && canIssue && selectedIds.size > 0 ? (
              <Button onClick={() => setBulkIssueOpen(true)} data-testid="certificates-bulk-issue-button">
                Bulk issue ({selectedIds.size})
              </Button>
            ) : null}
          </div>
        }
      />

      {batchId ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToBatches}
              data-testid="certificates-back-to-batches"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              All batches
            </Button>
            {batchName ? (
              <p className="text-sm text-fg-muted" data-testid="certificates-batch-context">
                <span className="font-medium text-fg">{batchName}</span>
                {programTitle ? ` · ${programTitle}` : null}
              </p>
            ) : null}
          </div>

          {isError ? errorState : studentTable}
        </>
      ) : (
        <CertificateBatchList onOpenBatch={handleOpenBatch} />
      )}

      {/* Dialogs */}
      <IssueCertificateDialog
        open={Boolean(issueTarget)}
        onOpenChange={(open) => !open && setIssueTarget(null)}
        enrollmentId={issueTarget?.enrollmentId ?? null}
        studentName={issueTarget?.studentName}
      />

      <RevokeCertificateDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        certificateId={revokeTarget?.certificateId ?? null}
        studentName={revokeTarget?.studentName}
        certUid={revokeTarget?.certUid}
      />

      <CertificatePreviewDialog
        open={Boolean(previewTarget)}
        onOpenChange={(open) => !open && setPreviewTarget(null)}
        certificateId={previewTarget?.certificateId ?? null}
        studentName={previewTarget?.studentName}
        programTitle={previewTarget?.programTitle}
        revoked={previewTarget?.revoked}
      />

      <BulkIssueDialog
        open={bulkIssueOpen}
        onOpenChange={setBulkIssueOpen}
        candidates={(data?.items ?? []).filter((row) => selectedIds.has(row.enrollmentId))}
        onDone={() => setSelectedIds(new Set())}
      />

      <CertTemplateSpecimenDrawer open={specimenOpen} onOpenChange={setSpecimenOpen} />
    </div>
  );
}
