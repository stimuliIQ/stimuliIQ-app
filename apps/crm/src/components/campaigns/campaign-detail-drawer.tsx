// Campaign detail drawer — metrics + recipient list + pause/cancel actions.
// RBAC: campaigns.send permission gates pause/cancel; campaigns.view for the rest.
// Confirm-on-destructive: cancel campaign uses ConfirmDialog (AC-36).
import * as React from "react";
import { Pause, X } from "lucide-react";
import {
  Button,
  CampaignMetricsCard,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  DetailGrid,
  DetailRow,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Select,
  SelectItem,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { CampaignDetailDto, CampaignRecipientDto, MeResponse, RecipientStatus } from "@repo/types";

import {
  useCampaign,
  useCampaignRecipients,
  useCampaignMetrics,
  usePauseCampaign,
  useCancelCampaign,
} from "../../hooks/use-campaigns";
import { hasPermission } from "../../lib/permissions";
import { CampaignStatusChip } from "./campaign-status-chip";
import { surfaceError } from "../../lib/surface-error";

const RECIPIENT_STATUS_MAP: Record<RecipientStatus, { tone: "neutral" | "info" | "success" | "warning" | "danger"; label: string }> = {
  queued:    { tone: "neutral", label: "Queued" },
  sent:      { tone: "info",    label: "Sent" },
  delivered: { tone: "success", label: "Delivered" },
  read:      { tone: "success", label: "Read" },
  failed:    { tone: "danger",  label: "Failed" },
};

const RECIPIENT_STATUS_OPTIONS: Array<{ value: RecipientStatus | ""; label: string }> = [
  { value: "",          label: "All" },
  { value: "queued",    label: "Queued" },
  { value: "sent",      label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "read",      label: "Read" },
  { value: "failed",    label: "Failed" },
];

interface CampaignDetailDrawerProps {
  campaignId: string | null;
  me: MeResponse | undefined;
  onClose: () => void;
}

export function CampaignDetailDrawer({
  campaignId,
  me,
  onClose,
}: CampaignDetailDrawerProps): React.JSX.Element {
  const canSend = hasPermission(me?.permissions, "campaigns.send");

  const [recipientStatusFilter, setRecipientStatusFilter] = React.useState<RecipientStatus | "">("");
  const [recipientPage, setRecipientPage] = React.useState(1);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const { toast } = useToast();

  const PAGE_SIZE = 20;

  const { data: campaign, isLoading: campaignLoading, isError: campaignError, refetch: refetchCampaign } =
    useCampaign(campaignId ?? undefined);

  const { data: metrics, isLoading: metricsLoading, isError: metricsError } =
    useCampaignMetrics(campaignId ?? undefined);

  const { data: recipients, isLoading: recipientsLoading, isFetching: recipientsFetching } =
    useCampaignRecipients(campaignId ?? undefined, {
      status: recipientStatusFilter || undefined,
      page: recipientPage,
      pageSize: PAGE_SIZE,
    });

  const pauseMutation = usePauseCampaign();
  const cancelMutation = useCancelCampaign();

  const canPause =
    canSend && campaign && (campaign.status === "sending" || campaign.status === "scheduled");
  const canCancel =
    canSend && campaign && (campaign.status === "scheduled" || campaign.status === "paused");

  function handlePause() {
    if (!campaignId) return;
    pauseMutation.mutate(campaignId, {
      onSuccess: () => {
        toast({ title: "Campaign paused", variant: "success" });
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to pause");
      },
    });
  }

  function handleCancel() {
    if (!campaignId) return;
    cancelMutation.mutate(campaignId, {
      onSuccess: () => {
        toast({ title: "Campaign cancelled", variant: "success" });
        setConfirmCancel(false);
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to cancel");
        setConfirmCancel(false);
      },
    });
  }

  const recipientColumns: Array<DataTableColumn<CampaignRecipientDto>> = [
    {
      id: "to",
      header: "Recipient",
      cell: (row) => row.to,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => {
        const { tone, label } = RECIPIENT_STATUS_MAP[row.status] ?? { tone: "neutral" as const, label: row.status };
        return <StatusChip tone={tone} label={label} />;
      },
    },
    {
      id: "sentAt",
      header: "Sent at",
      cell: (row) => (row.sentAt ? new Date(row.sentAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "-"),
    },
    {
      id: "deliveredAt",
      header: "Delivered",
      cell: (row) => (row.deliveredAt ? new Date(row.deliveredAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "-"),
    },
    {
      id: "error",
      header: "Error",
      cell: (row) => row.error ?? "-",
    },
  ];

  return (
    <>
      <Drawer open={Boolean(campaignId)} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent
          title={campaign?.name ?? "Campaign detail"}
          description={campaign ? `${campaign.channel.toUpperCase()} campaign` : undefined}
          size="xl"
          data-testid="campaign-detail-drawer"
        >
          {campaignLoading ? (
            <DrawerBody>
              <div className="flex flex-col gap-4">
                <Skeleton shape="line" className="h-8 w-1/3" />
                <Skeleton shape="block" className="h-24" />
                <Skeleton shape="block" className="h-40" />
              </div>
            </DrawerBody>
          ) : campaignError || !campaign ? (
            <DrawerBody>
              <EmptyState
                title="Failed to load campaign"
                description="Unable to fetch campaign details."
                action={
                  <Button variant="secondary" onClick={() => void refetchCampaign()} data-testid="campaign-detail-retry">
                    Try again
                  </Button>
                }
                data-testid="campaign-detail-error"
              />
            </DrawerBody>
          ) : (
            <>
              <DrawerBody className="flex flex-col gap-4 overflow-y-auto">
                {/* Summary */}
                <DetailGrid data-testid="campaign-detail-summary">
                  <DetailRow label="Status" value={<CampaignStatusChip status={campaign.status} />} />
                  <DetailRow
                    label="Created by"
                    value={`${campaign.createdByName} · ${new Date(campaign.createdAt).toLocaleDateString("en-IN")}`}
                  />
                  {campaign.scheduleAt ? (
                    <DetailRow
                      label="Scheduled"
                      value={new Date(campaign.scheduleAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      fullWidth
                    />
                  ) : null}
                </DetailGrid>

                {/* Metrics */}
                <CampaignMetricsCard
                  totalRecipients={metrics?.total ?? campaign.metrics.total}
                  sent={metrics?.sent ?? campaign.metrics.sent}
                  delivered={metrics?.delivered ?? campaign.metrics.delivered}
                  opened={metrics?.read ?? campaign.metrics.read}
                  failed={metrics?.failed ?? campaign.metrics.failed}
                  loading={metricsLoading}
                  error={metricsError ? "Failed to load metrics" : undefined}
                  campaignName={campaign.name}
                  data-testid="campaign-metrics-card"
                />

                {/* Recipients table */}
                <section aria-label="Campaign recipients">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-fg">Recipients</h2>
                    <Select
                      value={recipientStatusFilter}
                      onValueChange={(v) => {
                        setRecipientStatusFilter(v as RecipientStatus | "");
                        setRecipientPage(1);
                      }}
                      aria-label="Filter by recipient status"
                      placeholder="Filter by status"
                      className="w-36"
                      data-testid="recipient-status-filter"
                    >
                      {RECIPIENT_STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  <DataTable
                    columns={recipientColumns}
                    rows={recipients?.items ?? []}
                    getRowId={(row) => row.id}
                    loading={recipientsLoading || recipientsFetching}
                    pagination={{
                      page: recipientPage,
                      pageSize: PAGE_SIZE,
                      total: recipients?.meta.total ?? 0,
                      onPageChange: setRecipientPage,
                    }}
                    emptyState={{
                      title: "No recipients",
                      description:
                        recipientStatusFilter
                          ? "No recipients with this status."
                          : "Segment hasn't been materialized yet.",
                    }}
                    caption="Campaign recipient list"
                    data-testid="campaign-recipients-table"
                  />
                </section>
              </DrawerBody>

              {/* Footer actions — RBAC-aware: only show pause/cancel if campaigns.send */}
              {(canPause || canCancel) ? (
                <DrawerFooter>
                  {canCancel ? (
                    <Button
                      variant="destructive"
                      onClick={() => setConfirmCancel(true)}
                      data-testid="cancel-campaign-btn"
                    >
                      <X aria-hidden="true" className="size-4" />
                      Cancel campaign
                    </Button>
                  ) : null}
                  {canPause ? (
                    <Button
                      variant="secondary"
                      onClick={handlePause}
                      loading={pauseMutation.isPending}
                      data-testid="pause-campaign-btn"
                    >
                      <Pause aria-hidden="true" className="size-4" />
                      Pause
                    </Button>
                  ) : null}
                </DrawerFooter>
              ) : null}
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* Confirm destructive: cancel campaign */}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this campaign?"
        description="All queued recipients will be marked as failed. This action cannot be undone."
        confirmLabel="Cancel campaign"
        tone="danger"
        onConfirm={handleCancel}
        loading={cancelMutation.isPending}
        data-testid="confirm-cancel-campaign"
      />
    </>
  );
}
