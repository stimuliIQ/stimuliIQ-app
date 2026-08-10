// Batch-first landing table for Content > Certificates.
//
// Certification is cohort work: staff clear one batch at a time, and a flat
// per-enrollment list made them scan for the students of "Neuro Batch AUG"
// among every other batch's rows. So the page opens on batches and drills into
// the per-student eligibility table (CertificateDirectory) from a row.
//
// The counts come from GET /crm/certificates/eligibility-batches — cheap
// aggregates, a fixed 5 queries per page. "Completion" here is the
// progress_pct >= 90 gate ALONE: the assessments/final-project gates are only
// resolved inside a batch, so this column is never labelled "eligible".
import * as React from "react";
import { ChevronRight } from "lucide-react";
import {
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
} from "@repo/ui";
import type { EligibilityBatchSummary } from "@repo/types";

import { useEligibilityBatches } from "../../hooks/use-certificates";
import { useDebouncedValue } from "../../hooks/use-debounced-value";

interface CertificateBatchListProps {
  /** Drill into one cohort's per-student eligibility table. */
  onOpenBatch: (batch: EligibilityBatchSummary) => void;
}

export function CertificateBatchList({
  onOpenBatch,
}: CertificateBatchListProps): React.JSX.Element {
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const debouncedSearch = useDebouncedValue(search);
  const pageSize = 20;

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isFetching, isError, refetch } = useEligibilityBatches({
    page,
    pageSize,
    search: debouncedSearch || undefined,
  });

  const rows = data?.items ?? [];
  // A column of zeros is noise — revocation is rare, so the column only appears
  // when some cohort on this page actually has one.
  const showRevoked = rows.some((row) => row.revokedCount > 0);

  const columns: Array<DataTableColumn<EligibilityBatchSummary>> = [
    {
      id: "batchName",
      header: "Batch",
      // A real button, not just the row's onClick: row clicks are mouse-only, and
      // opening a cohort has to be reachable by keyboard (CLAUDE.md §3.9).
      cell: (row) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenBatch(row);
          }}
          className="rounded text-left font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${row.batchName} (${row.studentCount} ${
            row.studentCount === 1 ? "student" : "students"
          })`}
          data-testid={`certificates-batch-open-${row.batchId}`}
        >
          {row.batchName}
        </button>
      ),
    },
    { id: "programTitle", header: "Program", cell: (row) => row.programTitle },
    {
      id: "studentCount",
      header: "Students",
      cell: (row) => <span className="text-sm font-medium text-fg">{row.studentCount}</span>,
      align: "right",
    },
    {
      id: "completionReadyCount",
      header: "Completion ≥ 90%",
      cell: (row) => (
        <span
          className={
            row.completionReadyCount > 0
              ? "text-sm font-medium text-fg"
              : "text-sm text-fg-muted"
          }
        >
          {row.completionReadyCount}
        </span>
      ),
      align: "right",
    },
    {
      id: "issuedCount",
      header: "Issued",
      cell: (row) => (
        <span
          className={
            row.issuedCount > 0 ? "text-sm font-medium text-success" : "text-sm text-fg-muted"
          }
        >
          {row.issuedCount}
        </span>
      ),
      align: "right",
    },
    {
      id: "pendingCount",
      header: "Not issued",
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {Math.max(row.studentCount - row.issuedCount, 0)}
        </span>
      ),
      align: "right",
    },
    ...(showRevoked
      ? [
          {
            id: "revokedCount",
            header: "Revoked",
            cell: (row: EligibilityBatchSummary) => (
              <span
                className={
                  row.revokedCount > 0 ? "text-sm font-medium text-danger" : "text-sm text-fg-muted"
                }
              >
                {row.revokedCount}
              </span>
            ),
            align: "right" as const,
          },
        ]
      : []),
    {
      id: "drill",
      header: "",
      cell: () => (
        <ChevronRight className="size-4 text-fg-subtle" aria-hidden="true" />
      ),
      align: "right",
    },
  ];

  if (isError) {
    return (
      <EmptyState
        data-testid="certificates-batches-error"
        title="Couldn't load batches"
        description="Something went wrong fetching the certificate batch summary."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="certificates-batches-retry">
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="certificates-batch-list">
      <DataFilterBar data-testid="certificates-batches-filter-bar">
        <Input
          label="Search"
          placeholder="Batch or program"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="w-56"
          data-testid="certificates-batches-search-input"
        />
      </DataFilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.batchId}
        loading={isLoading || isFetching}
        onRowClick={(row) => onOpenBatch(row)}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{
          title: "No batches to certify",
          description:
            "Batches appear here once they have enrolled students. Try adjusting your search.",
        }}
        caption="Certificate eligibility by batch"
        data-testid="certificates-batches-table"
      />
    </div>
  );
}
