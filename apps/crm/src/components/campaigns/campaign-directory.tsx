// Campaign directory — server-paginated DataTable + status/channel filters.
// RBAC-aware: "New campaign" and "Send" buttons are gated on campaigns.create / campaigns.send.
// Clicking a row opens CampaignDetailDrawer (metrics + recipients + pause/cancel).
import * as React from "react";
import { Plus, LayoutTemplate } from "lucide-react";
import {
  Button,
  DataFilterBar,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
} from "@repo/ui";
import type {
  CampaignChannel,
  CampaignDto,
  CampaignStatus,
  MeResponse,
} from "@repo/types";

import { useCampaignsList } from "../../hooks/use-campaigns";
import { getModulePermissions } from "../../lib/permissions";
import { CampaignStatusChip } from "./campaign-status-chip";
import { CampaignBuilderDrawer } from "./campaign-builder-drawer";
import { CampaignDetailDrawer } from "./campaign-detail-drawer";
import { CampaignTemplatesManagerDrawer } from "./campaign-templates-manager-drawer";

const STATUS_FILTER_OPTIONS: Array<{ value: CampaignStatus | ""; label: string }> = [
  { value: "",           label: "All statuses" },
  { value: "draft",      label: "Draft" },
  { value: "scheduled",  label: "Scheduled" },
  { value: "sending",    label: "Sending" },
  { value: "sent",       label: "Sent" },
  { value: "paused",     label: "Paused" },
  { value: "cancelled",  label: "Cancelled" },
  { value: "failed",     label: "Failed" },
];

const CHANNEL_FILTER_OPTIONS: Array<{ value: CampaignChannel | ""; label: string }> = [
  { value: "",          label: "All channels" },
  { value: "email",     label: "Email" },
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "sms",       label: "SMS" },
];

interface CampaignDirectoryProps {
  me: MeResponse | undefined;
}

export function CampaignDirectory({ me }: CampaignDirectoryProps): React.JSX.Element {
  const campaignPermissions = getModulePermissions(me, "campaigns");

  const [statusFilter, setStatusFilter] = React.useState<CampaignStatus | "">("");
  const [channelFilter, setChannelFilter] = React.useState<CampaignChannel | "">("");
  const [page, setPage] = React.useState(1);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = React.useState<string | null>(null);

  const PAGE_SIZE = 20;

  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, channelFilter]);

  const { data, isLoading, isError, refetch, isFetching } = useCampaignsList({
    status: statusFilter || undefined,
    channel: channelFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns: Array<DataTableColumn<CampaignDto>> = [
    {
      id: "name",
      header: "Campaign",
      cell: (row) => (
        <span className="font-medium text-fg">{row.name}</span>
      ),
      sortable: true,
    },
    {
      id: "channel",
      header: "Channel",
      cell: (row) => (
        <span className="text-sm capitalize text-fg-muted">{row.channel}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <CampaignStatusChip status={row.status} />,
    },
    {
      id: "sent",
      header: "Sent",
      cell: (row) => row.metrics.sent.toLocaleString(),
      align: "right",
    },
    {
      id: "delivered",
      header: "Delivered",
      cell: (row) => row.metrics.delivered.toLocaleString(),
      align: "right",
    },
    {
      id: "read",
      header: "Opened",
      cell: (row) => row.metrics.read.toLocaleString(),
      align: "right",
    },
    {
      id: "scheduleAt",
      header: "Schedule",
      cell: (row) =>
        row.scheduleAt
          ? new Date(row.scheduleAt).toLocaleDateString("en-IN")
          : row.status === "sent"
            ? "Sent"
            : "Immediate",
    },
    {
      id: "createdByName",
      header: "Created by",
      cell: (row) => row.createdByName,
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (row) => new Date(row.createdAt).toLocaleDateString("en-IN"),
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load campaigns"
        description="Something went wrong fetching the campaign list."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="campaigns-retry">
            Try again
          </Button>
        }
        data-testid="campaigns-error"
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="campaign-directory">
      <PageHeader
        title="Campaigns"
        description="Email, WhatsApp, and SMS bulk campaigns with per-recipient delivery tracking."
        actions={
          /* RBAC: authoring actions require campaigns.create */
          campaignPermissions.canCreate ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setTemplatesOpen(true)}
                data-testid="manage-templates-btn"
              >
                <LayoutTemplate className="size-4" aria-hidden="true" />
                Templates
              </Button>
              <Button onClick={() => setBuilderOpen(true)} data-testid="new-campaign-btn">
                <Plus className="size-4" aria-hidden="true" />
                New campaign
              </Button>
            </div>
          ) : null
        }
      />

      {/* Filters */}
      <DataFilterBar data-testid="campaign-filter-bar">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as CampaignStatus | "")}
          aria-label="Filter by campaign status"
          placeholder="Select status"
          className="w-44"
          data-testid="campaign-status-filter"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>

        <Select
          value={channelFilter}
          onValueChange={(v) => setChannelFilter(v as CampaignChannel | "")}
          aria-label="Filter by channel"
          placeholder="Select channel"
          className="w-40"
          data-testid="campaign-channel-filter"
        >
          {CHANNEL_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </DataFilterBar>

      {/* Campaign list table */}
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setSelectedCampaignId(row.id)}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.meta.total ?? 0,
          onPageChange: setPage,
        }}
        emptyState={{
          title: "No campaigns yet",
          description: "Create your first campaign to start reaching your audience.",
        }}
        caption="Campaign directory"
        data-testid="campaigns-table"
      />

      {/* Builder (create) drawer */}
      <CampaignBuilderDrawer
        open={builderOpen}
        onOpenChange={setBuilderOpen}
      />

      {/* Templates manager (create / edit / delete reusable templates) */}
      <CampaignTemplatesManagerDrawer
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
      />

      {/* Detail drawer (metrics + recipients + pause/cancel) */}
      <CampaignDetailDrawer
        campaignId={selectedCampaignId}
        me={me}
        onClose={() => setSelectedCampaignId(null)}
      />
    </div>
  );
}
