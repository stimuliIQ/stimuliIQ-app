// Student 360 — Certificates tab (Phase 9 Completion T37). The CRM
// eligibility list is the only endpoint that already carries per-enrollment
// certificate status keyed by studentId — filtered client-side (the query
// only supports filtering eligibility by student *name* search, not id).
import * as React from "react";
import { Eye } from "lucide-react";
import { Button, DataTable, type DataTableColumn, StatusChip } from "@repo/ui";
import type { EligibilityListItem } from "@repo/types";

import { useEligibilityList } from "../../hooks/use-certificates";
import { certificateVerifyUrl } from "../../lib/public-urls";
import { CertificatePreviewDialog } from "../certificates/certificate-preview-dialog";

export function StudentCertificatesTab({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}): React.JSX.Element {
  const { data, isLoading, isError } = useEligibilityList({ search: studentName, page: 1, pageSize: 50 });
  const [previewTarget, setPreviewTarget] = React.useState<{
    certificateId: string;
    programTitle: string;
    revoked: boolean;
  } | null>(null);
  const rows = (data?.items ?? []).filter((item) => item.studentId === studentId);

  const columns: Array<DataTableColumn<EligibilityListItem>> = [
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    { id: "batchName", header: "Batch", cell: (row) => row.batchName },
    {
      id: "eligible",
      header: "Eligible",
      cell: (row) =>
        row.eligibility.eligible ? (
          <StatusChip tone="success" label="Eligible" size="sm" />
        ) : (
          <StatusChip tone="neutral" label="Not yet" size="sm" />
        ),
    },
    {
      id: "certificateStatus",
      header: "Certificate",
      cell: (row) =>
        row.certificateStatus ? (
          <StatusChip
            tone={row.certificateStatus === "valid" ? "success" : "danger"}
            label={row.certificateStatus === "valid" ? "Issued" : "Revoked"}
            size="sm"
          />
        ) : (
          <StatusChip tone="neutral" label="Not issued" size="sm" />
        ),
    },
    {
      id: "view",
      header: "Document",
      // The same panel the Certificates queue uses. A member of staff on a student record
      // is usually there BECAUSE the student asked about their certificate, so the answer
      // has to be one click from here too, not a trip to another screen.
      cell: (row) =>
        row.certificateId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setPreviewTarget({
                certificateId: row.certificateId as string,
                programTitle: row.programTitle,
                revoked: row.certificateStatus === "revoked",
              })
            }
            aria-label={`View the ${row.programTitle} certificate`}
            data-testid={`student-view-certificate-${row.enrollmentId}`}
          >
            <Eye className="mr-1 size-3.5" aria-hidden="true" />
            View
          </Button>
        ) : (
          "-"
        ),
    },
    {
      id: "certUid",
      header: "Verify",
      cell: (row) =>
        row.certUid ? (
          <a
            href={certificateVerifyUrl(row.certUid)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand-500 hover:underline"
          >
            {row.certUid}
          </a>
        ) : (
          "-"
        ),
    },
  ];

  if (isError) {
    return <p role="alert" className="text-sm text-danger">Couldn't load certificate eligibility.</p>;
  }

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.enrollmentId}
        loading={isLoading}
        caption="Student certificate eligibility"
        emptyState={{
          title: "No certificate activity",
          description: "Nothing to show for this student's enrollments yet.",
        }}
        data-testid="student-certificates-table"
      />

      <CertificatePreviewDialog
        open={Boolean(previewTarget)}
        onOpenChange={(open) => !open && setPreviewTarget(null)}
        certificateId={previewTarget?.certificateId ?? null}
        studentName={studentName}
        programTitle={previewTarget?.programTitle}
        revoked={previewTarget?.revoked}
      />
    </>
  );
}
