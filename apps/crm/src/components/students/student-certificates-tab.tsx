// Student 360 — Certificates tab (Phase 9 Completion T37). The CRM
// eligibility list is the only endpoint that already carries per-enrollment
// certificate status keyed by studentId — filtered client-side (the query
// only supports filtering eligibility by student *name* search, not id).
import * as React from "react";
import { DataTable, type DataTableColumn, StatusChip } from "@repo/ui";
import type { EligibilityListItem } from "@repo/types";

import { useEligibilityList } from "../../hooks/use-certificates";
import { certificateVerifyUrl } from "../../lib/public-urls";

export function StudentCertificatesTab({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}): React.JSX.Element {
  const { data, isLoading, isError } = useEligibilityList({ search: studentName, page: 1, pageSize: 50 });
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
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.enrollmentId}
      loading={isLoading}
      caption="Student certificate eligibility"
      emptyState={{ title: "No certificate activity", description: "Nothing to show for this student's enrollments yet." }}
      data-testid="student-certificates-table"
    />
  );
}
