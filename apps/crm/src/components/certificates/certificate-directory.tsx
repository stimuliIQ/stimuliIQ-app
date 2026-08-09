// Certificate directory — Content > Certificates CRM view.
// Eligibility list + issue / revoke / reissue + verify link.
// RBAC-aware: issue only with certificates.issue, revoke only with
// certificates.revoke (UI hides affordances, API enforces).
// Revoke is a destructive action — always gated by RevokeCertificateDialog
// which requires a reason (ConfirmDialog pattern with extra input, AC-G1).
import * as React from "react";
import { ExternalLink } from "lucide-react";
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
import type { EligibilityListItem, MeResponse } from "@repo/types";

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
import { CertTemplateDesignerDrawer } from "./cert-template-designer-drawer";
import { certificateVerifyUrl } from "../../lib/public-urls";

interface CertificateDirectoryProps {
  me: MeResponse | undefined;
}

export function CertificateDirectory({ me }: CertificateDirectoryProps): React.JSX.Element {
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
  const [bulkIssueOpen, setBulkIssueOpen] = React.useState(false);
  const [designerOpen, setDesignerOpen] = React.useState(false);

  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;
  const { toast } = useToast();

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, eligibleFilter, hasRecommendation]);

  const { data, isLoading, isError, refetch, isFetching } = useEligibilityList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    eligible: eligibleFilter,
    hasRecommendation,
  });

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
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
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
      const description =
        error && typeof error === "object" && "problem" in error
          ? ((error as { problem: { detail?: string; title?: string } }).problem.detail ??
            (error as { problem: { detail?: string; title?: string } }).problem.title)
          : error instanceof Error
            ? error.message
            : undefined;
      toast({ title: "Couldn't reissue certificate", description, variant: "destructive" });
    }
  };

  const columns: Array<DataTableColumn<EligibilityListItem>> = [
    { id: "studentName", header: "Student", cell: (row) => row.studentName, sortable: true },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName },
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
            {row.eligibility.reasons.completionPassed ? " — passed" : " — below 90% threshold"}
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
          <StatusChip
            size="sm"
            className="whitespace-nowrap"
            tone={row.certificateStatus === "valid" ? "success" : "danger"}
            label={row.certificateStatus === "valid" ? "Issued" : "Revoked"}
          />
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

  if (isError) {
    return (
      <EmptyState
        data-testid="certificates-error"
        title="Couldn't load eligibility list"
        description="Something went wrong fetching certificate eligibility data."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="certificates-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="certificates-directory">
      <PageHeader
        title="Certificates"
        description="Eligibility breakdown per enrollment. Issue, revoke, and reissue certificates."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setDesignerOpen(true)} data-testid="certificates-template-designer-button">
              Template designer
            </Button>
            {canIssue && selectedIds.size > 0 ? (
              <Button onClick={() => setBulkIssueOpen(true)} data-testid="certificates-bulk-issue-button">
                Bulk issue ({selectedIds.size})
              </Button>
            ) : null}
          </div>
        }
      />

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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Eligibility breakdown</h2>
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

      <BulkIssueDialog
        open={bulkIssueOpen}
        onOpenChange={setBulkIssueOpen}
        candidates={(data?.items ?? []).filter((row) => selectedIds.has(row.enrollmentId))}
        onDone={() => setSelectedIds(new Set())}
      />

      <CertTemplateDesignerDrawer open={designerOpen} onOpenChange={setDesignerOpen} />
    </div>
  );
}
