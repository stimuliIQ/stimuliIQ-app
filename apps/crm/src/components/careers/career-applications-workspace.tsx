// CRM ▸ Careers ▸ Applications — the candidate queue (ADR-0066).
//
// DEFAULTS TO "NEW", not to everything. The question this screen answers on open is "who is
// waiting on me?", and an unfiltered list of every application ever received buries that
// under people who were dealt with months ago. Every other status is one click away.
//
// The queue is a list; the decision happens in the drawer, where the resume and cover letter
// are on screen. There are deliberately no row-level decision buttons: nobody should be able
// to reject a person from a table row without having opened what they sent.
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import {
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { CareerApplicationStatus, CareerApplicationSummary, MeResponse } from "@repo/types";

import { useCareerApplicationsList, useJobOpeningsList } from "../../hooks/use-careers";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { CareerApplicationDrawer, applicationStatusLabel, applicationStatusTone } from "./career-application-drawer";

const STATUS_FILTERS: Array<{ value: CareerApplicationStatus | ""; label: string }> = [
  { value: "new", label: "New, awaiting a decision" },
  { value: "shortlisted", label: "Next round" },
  { value: "on_hold", label: "On hold" },
  { value: "selected", label: "Offer sent" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "All applications" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export interface CareerApplicationsWorkspaceProps {
  me: MeResponse | undefined;
  /** Pre-filter to one opening — set by the "12 applicants" link on the openings screen. */
  initialJobOpeningId?: string;
}

export function CareerApplicationsWorkspace({
  me,
  initialJobOpeningId,
}: CareerApplicationsWorkspaceProps): React.JSX.Element {
  useToast();
  const canReview = hasPermission(me?.permissions, "careers.review");

  // Arriving from an opening's applicant count means "show me everyone who applied for
  // this role", so that entry point widens the status filter as well as narrowing the role.
  const [status, setStatus] = React.useState<CareerApplicationStatus | "">(initialJobOpeningId ? "" : "new");
  const [jobOpeningId, setJobOpeningId] = React.useState<string>(initialJobOpeningId ?? "");
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useCareerApplicationsList({
    page: 1,
    pageSize: 100,
    ...(status ? { status } : {}),
    ...(jobOpeningId ? { jobOpeningId } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  });

  // Every opening, including closed ones: the filter has to be able to reach applications
  // for a role that is no longer advertised, which is most of them after a hiring round.
  const { data: openings } = useJobOpeningsList({ page: 1, pageSize: 100 });

  const columns: Array<DataTableColumn<CareerApplicationSummary>> = [
    {
      id: "candidate",
      header: "Candidate",
      cell: (row) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{row.name}</div>
          <div className="truncate text-xs text-fg-subtle">{row.email}</div>
        </div>
      ),
    },
    { id: "role", header: "Applied for", cell: (row) => row.role },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusChip tone={applicationStatusTone(row.status)} label={applicationStatusLabel(row.status)} size="sm" />
      ),
    },
    {
      id: "acknowledged",
      header: "Confirmed",
      cell: (row) =>
        row.acknowledgedAt ? (
          <span className="text-xs text-fg-subtle">Sent</span>
        ) : (
          // Worth a warning icon in the LIST, not just the drawer: a candidate who was never
          // acknowledged has heard nothing from us at all, and that should be visible without
          // opening every row.
          <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-fg">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            Not sent
          </span>
        ),
    },
    { id: "applied", header: "Applied", cell: (row) => formatDate(row.createdAt) },
    {
      id: "decidedBy",
      header: "Decided by",
      cell: (row) => row.decidedByName ?? <span className="text-xs text-fg-subtle">-</span>,
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load applications"
        data-testid="career-applications-error"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const isFiltered = Boolean(status || jobOpeningId || debouncedSearch);

  return (
    <div className="space-y-4 md:space-y-5" data-testid="career-applications-workspace">
      <PageHeader
        title="Applications"
        description="Everyone who has applied through the careers page. Open a candidate to read their resume and decide. Every decision except Hold emails them."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Input
          aria-label="Search applications"
          placeholder="Search by name, email, role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="w-72"
          data-testid="applications-search-input"
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onValueChange={(value) => setStatus(value as CareerApplicationStatus | "")}
          wrapperClassName="w-56"
          data-testid="applications-status-filter"
        >
          {STATUS_FILTERS.map((option) => (
            <SelectItem key={option.value || "all"} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>
        <Select
          aria-label="Filter by opening"
          value={jobOpeningId}
          onValueChange={setJobOpeningId}
          wrapperClassName="w-64"
          data-testid="applications-opening-filter"
        >
          <SelectItem value="">All openings</SelectItem>
          {(openings?.items ?? []).map((opening) => (
            <SelectItem key={opening.id} value={opening.id}>
              {opening.title}
            </SelectItem>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        onRowClick={(row) => setOpenId(row.id)}
        emptyState={
          isFiltered
            ? { title: "Nothing matches these filters", description: "Try a different status, opening, or search term." }
            : {
                title: "No applications yet",
                description:
                  "Applications arrive here the moment someone applies on the careers page. Publish an opening under Careers ▸ Openings to start receiving them.",
              }
        }
        caption="Career applications"
        data-testid="applications-table"
      />

      <CareerApplicationDrawer
        applicationId={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
        canReview={canReview}
      />
    </div>
  );
}
