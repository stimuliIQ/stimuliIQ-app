// Shared param-filter fields for the Export creation drawer + the Report
// schedule creation drawer (docs/plans/phase-7.md Wave 3 task #15). Renders
// the SAME filters as the matching on-screen dashboard/list for each export
// type (Rule H-2/AC-32 — the export/schedule `params` shape is literally the
// on-screen query DTO, never a separate/broader shape) — field sets below
// mirror components/analytics/*-dashboard.tsx and the Students/Leads/
// Payments list filters 1:1.
//
// Presentation only: values live in the parent drawer's state and are
// validated against the real zod query schema (@repo/types) at submit time,
// not here.
import * as React from "react";
import { CourseTypeSelect, COURSE_TYPE_ALL } from "../students/course-type-select";
import { Input, Select, SelectItem } from "@repo/ui";
import type { ExportEntityType } from "@repo/types";

import { useAllBranches } from "../../hooks/use-branches";
import { useBatchesList } from "../../hooks/use-batches";
import { useProgramsList } from "../../hooks/use-courses";
import { useCampaignsList } from "../../hooks/use-campaigns";

export interface ReportParamsBag {
  from?: string;
  to?: string;
  granularity?: string;
  branchId?: string;
  batchId?: string;
  programId?: string;
  campaignId?: string;
  search?: string;
  status?: string;
  courseType?: string;
  stage?: string;
  source?: string;
  orderId?: string;
}

export interface ReportParamsFieldsProps {
  type: ExportEntityType;
  params: ReportParamsBag;
  onChange: (patch: Partial<ReportParamsBag>) => void;
  /** Prefix for data-testids, e.g. "export-form" or "schedule-form". */
  idPrefix: string;
}

const DATE_RANGE_TYPES = new Set<ExportEntityType>(["revenue", "enrollments", "funnel"]);
const OPTIONAL_BATCH_ONLY_TYPES = new Set<ExportEntityType>(["gamification", "forum-health"]);

/** Reference lists are capped well under the API's page-size max (100) — these are pickers, not paginated tables. */
const PICKER_PAGE_SIZE = 100;

const STUDENT_STATUS_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "alumni", label: "Completed" },
];

const LEAD_STAGE_OPTIONS = [
  { value: "new", label: "New Lead" },
  { value: "follow_up", label: "Follow-up" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "created", label: "Created" },
  { value: "authorized", label: "Authorized" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

export function ReportParamsFields({ type, params, onChange, idPrefix }: ReportParamsFieldsProps): React.JSX.Element | null {
  const { data: branches } = useAllBranches();
  const { data: programs } = useProgramsList({ page: 1, pageSize: PICKER_PAGE_SIZE, includeDeleted: false });
  const { data: batches } = useBatchesList({
    page: 1,
    pageSize: PICKER_PAGE_SIZE,
    status: "active",
    includeDeleted: false,
    programId: type === "engagement" ? params.programId : undefined,
  });
  const { data: campaigns } = useCampaignsList({ page: 1, pageSize: PICKER_PAGE_SIZE });

  if (DATE_RANGE_TYPES.has(type)) {
    return (
      <>
        <Input
          label="From"
          type="date"
          required
          value={params.from ?? ""}
          onChange={(event) => onChange({ from: event.target.value })}
          data-testid={`${idPrefix}-from`}
        />
        <Input
          label="To"
          type="date"
          required
          value={params.to ?? ""}
          onChange={(event) => onChange({ to: event.target.value })}
          data-testid={`${idPrefix}-to`}
        />
        {type === "enrollments" ? (
          <Select
            label="Granularity"
            placeholder="Auto (server-chosen)"
            value={params.granularity}
            onValueChange={(value) => onChange({ granularity: value })}
            data-testid={`${idPrefix}-granularity`}
          >
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </Select>
        ) : null}
        <Select
          label="Branch"
          placeholder="All branches"
          value={params.branchId}
          onValueChange={(value) => onChange({ branchId: value === "__all__" ? undefined : value })}
          data-testid={`${idPrefix}-branch`}
        >
          <SelectItem value="__all__">All branches</SelectItem>
          {(branches?.items ?? []).map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </Select>
      </>
    );
  }

  if (OPTIONAL_BATCH_ONLY_TYPES.has(type)) {
    return (
      <Select
        label="Batch"
        placeholder="All batches (tenant-wide)"
        value={params.batchId}
        onValueChange={(value) => onChange({ batchId: value === "__all__" ? undefined : value })}
        data-testid={`${idPrefix}-batch`}
      >
        <SelectItem value="__all__">All batches</SelectItem>
        {(batches?.items ?? []).map((batch) => (
          <SelectItem key={batch.id} value={batch.id}>
            {batch.name}
          </SelectItem>
        ))}
      </Select>
    );
  }

  if (type === "engagement") {
    return (
      <>
        <Select
          label="Program"
          required
          placeholder="Select a program"
          value={params.programId}
          onValueChange={(value) => onChange({ programId: value, batchId: undefined })}
          data-testid={`${idPrefix}-program`}
        >
          {(programs?.items ?? []).map((program) => (
            <SelectItem key={program.id} value={program.id}>
              {program.title}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="Batch"
          placeholder="All batches for this program"
          value={params.batchId}
          onValueChange={(value) => onChange({ batchId: value === "__all__" ? undefined : value })}
          disabled={!params.programId}
          data-testid={`${idPrefix}-batch`}
        >
          <SelectItem value="__all__">All batches</SelectItem>
          {(batches?.items ?? []).map((batch) => (
            <SelectItem key={batch.id} value={batch.id}>
              {batch.name}
            </SelectItem>
          ))}
        </Select>
      </>
    );
  }

  if (type === "campaigns" || type === "campaign-audience") {
    return (
      <Select
        label="Campaign"
        required
        placeholder="Select a campaign"
        value={params.campaignId}
        onValueChange={(value) => onChange({ campaignId: value })}
        data-testid={`${idPrefix}-campaign`}
      >
        {(campaigns?.items ?? []).map((campaign) => (
          <SelectItem key={campaign.id} value={campaign.id}>
            {campaign.name}
          </SelectItem>
        ))}
      </Select>
    );
  }

  if (type === "students") {
    return (
      <>
        <Input
          label="Search"
          placeholder="Name, email, or phone"
          value={params.search ?? ""}
          onChange={(event) => onChange({ search: event.target.value })}
          data-testid={`${idPrefix}-search`}
        />
        <Select
          label="Status"
          placeholder="All statuses"
          value={params.status}
          onValueChange={(value) => onChange({ status: value === "__all__" ? undefined : value })}
          data-testid={`${idPrefix}-status`}
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {STUDENT_STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <CourseTypeSelect
          value={params.courseType ?? COURSE_TYPE_ALL}
          onChange={(value) => onChange({ courseType: value === COURSE_TYPE_ALL ? undefined : value })}
          includeAllOption
          placeholder="All course types"
          data-testid={`${idPrefix}-course-type`}
        />
      </>
    );
  }

  if (type === "leads") {
    return (
      <>
        <Input
          label="Search"
          placeholder="Name, phone, or email"
          value={params.search ?? ""}
          onChange={(event) => onChange({ search: event.target.value })}
          data-testid={`${idPrefix}-search`}
        />
        <Input
          label="Source"
          placeholder="e.g. referral, website"
          value={params.source ?? ""}
          onChange={(event) => onChange({ source: event.target.value })}
          data-testid={`${idPrefix}-source`}
        />
        <Select
          label="Stage"
          placeholder="All stages"
          value={params.stage}
          onValueChange={(value) => onChange({ stage: value === "__all__" ? undefined : value })}
          data-testid={`${idPrefix}-stage`}
        >
          <SelectItem value="__all__">All stages</SelectItem>
          {LEAD_STAGE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </>
    );
  }

  if (type === "payments") {
    return (
      <>
        <Input
          label="Order ID"
          placeholder="Filter by order id"
          value={params.orderId ?? ""}
          onChange={(event) => onChange({ orderId: event.target.value })}
          data-testid={`${idPrefix}-order-id`}
        />
        <Select
          label="Status"
          placeholder="All statuses"
          value={params.status}
          onValueChange={(value) => onChange({ status: value === "__all__" ? undefined : value })}
          data-testid={`${idPrefix}-status`}
        >
          <SelectItem value="__all__">All statuses</SelectItem>
          {PAYMENT_STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
        <Input
          label="From"
          type="date"
          helperText="Optional, leave blank for all-time."
          value={params.from ?? ""}
          onChange={(event) => onChange({ from: event.target.value })}
          data-testid={`${idPrefix}-from`}
        />
        <Input
          label="To"
          type="date"
          helperText="Optional, leave blank for all-time."
          value={params.to ?? ""}
          onChange={(event) => onChange({ to: event.target.value })}
          data-testid={`${idPrefix}-to`}
        />
      </>
    );
  }

  // "gamification" is handled by OPTIONAL_BATCH_ONLY_TYPES above; every
  // ExportEntityType is covered — this is unreachable but keeps the
  // function total rather than silently rendering nothing on a future enum add.
  return null;
}
ReportParamsFields.displayName = "ReportParamsFields";
