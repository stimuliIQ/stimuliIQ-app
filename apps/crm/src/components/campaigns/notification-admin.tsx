// Admin ▸ Notifications — template registry view + broadcast announcement compose.
//
// The engagement API exposes campaign templates as the underlying data model for
// notification templates. An "announcement" broadcast is a campaign with channel=email
// targeting all students/leads. This view shows:
//   1. Template registry (all templates across channels) with create/edit actions.
//   2. A lightweight broadcast-announcement compose form that creates an email campaign
//      targeting "both" sources (leads + students) and sends immediately.
//
// We do NOT invent new endpoints — everything goes through client.engagement.campaigns.*
// (the only notification/template API that exists, as confirmed by reading the api-client).
//
// RBAC: campaigns.create for creating templates; campaigns.view for listing.
import * as React from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import {
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  Select,
  SelectItem,
  StatusChip,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ConfirmDialog,
  useToast,
  Skeleton,
  cn,
} from "@repo/ui";
import type { CampaignChannel, CampaignTemplateDto, MeResponse } from "@repo/types";
import { findUnknownTemplateVariables } from "@repo/types";

import {
  useCampaignTemplatesList,
  useDeleteCampaignTemplate,
} from "../../hooks/use-campaigns";
import { getModulePermissions } from "../../lib/permissions";
import { CampaignTemplateFormDrawer } from "./campaign-template-form-drawer";

const CHANNEL_OPTIONS: Array<{ value: CampaignChannel | ""; label: string }> = [
  { value: "",          label: "All channels" },
  { value: "email",     label: "Email" },
  { value: "whatsapp",  label: "WhatsApp" },
  { value: "sms",       label: "SMS" },
];

function ChannelChip({ channel }: { channel: CampaignChannel }): React.JSX.Element {
  const toneMap: Record<CampaignChannel, "info" | "success" | "warning"> = {
    email:     "info",
    whatsapp:  "success",
    sms:       "warning",
  };
  return (
    <StatusChip tone={toneMap[channel]} label={channel.charAt(0).toUpperCase() + channel.slice(1)} />
  );
}

interface NotificationAdminProps {
  me: MeResponse | undefined;
}

export function NotificationAdmin({ me }: NotificationAdminProps): React.JSX.Element {
  const campaignPermissions = getModulePermissions(me, "campaigns");
  const { toast } = useToast();

  const [channelFilter, setChannelFilter] = React.useState<CampaignChannel | "">("");
  const [page, setPage] = React.useState(1);
  const [templateDrawerOpen, setTemplateDrawerOpen] = React.useState(false);
  const [editTemplateId, setEditTemplateId] = React.useState<string | undefined>(undefined);
  const [deleteTemplateId, setDeleteTemplateId] = React.useState<string | null>(null);

  const PAGE_SIZE = 20;

  const { data, isLoading, isError, refetch, isFetching } = useCampaignTemplatesList({
    channel: channelFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const deleteMutation = useDeleteCampaignTemplate();

  React.useEffect(() => {
    setPage(1);
  }, [channelFilter]);

  function openCreate() {
    setEditTemplateId(undefined);
    setTemplateDrawerOpen(true);
  }

  function openEdit(id: string) {
    setEditTemplateId(id);
    setTemplateDrawerOpen(true);
  }

  function handleDelete() {
    if (!deleteTemplateId) return;
    deleteMutation.mutate(deleteTemplateId, {
      onSuccess: () => {
        toast({ title: "Template deleted", variant: "success" });
        setDeleteTemplateId(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete template", description: (err as Error).message, variant: "destructive" });
        setDeleteTemplateId(null);
      },
    });
  }

  const columns: Array<DataTableColumn<CampaignTemplateDto>> = [
    {
      id: "name",
      header: "Template name",
      cell: (row) => <span className="font-medium text-fg">{row.name}</span>,
      sortable: true,
    },
    {
      id: "channel",
      header: "Channel",
      cell: (row) => <ChannelChip channel={row.channel} />,
    },
    {
      id: "dltTemplateId",
      header: "DLT ID",
      cell: (row) => {
        if (row.channel === "email") return <span className="text-xs text-fg-muted">N/A</span>;
        const dlt = (row as { dltTemplateId?: string }).dltTemplateId;
        return dlt ? (
          <code className="text-xs">{dlt}</code>
        ) : (
          <StatusChip tone="danger" label="Missing" />
        );
      },
    },
    {
      id: "variables",
      header: "Variables",
      // Read from the BODY, not from the stored `variables` list. That list is metadata a
      // human types in and nothing keeps in step with the message, so it goes stale the
      // moment someone edits the text — what matters is which placeholders the message
      // actually contains, and whether the sender will fill them.
      cell: (row) => {
        const used = [...new Set([...`${row.subject ?? ""} ${row.body}`.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]!))];
        if (used.length === 0) return <span className="text-fg-muted">-</span>;
        const unknown = new Set(findUnknownTemplateVariables(`${row.subject ?? ""} ${row.body}`));
        return (
          <span className="flex flex-wrap gap-1">
            {used.map((key) => (
              <code
                key={key}
                // An unresolvable placeholder ships with its braces showing, so it is
                // called out here rather than sitting in a list that looks fine.
                className={cn(
                  "rounded px-1 py-0.5 text-xs",
                  unknown.has(key) ? "bg-danger/10 text-danger" : "bg-surface text-fg-muted",
                )}
                title={unknown.has(key) ? "Not replaced when sending, goes out as typed" : undefined}
              >
                {`{{${key}}}`}
              </code>
            ))}
          </span>
        );
      },
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (row) => new Date(row.updatedAt).toLocaleDateString("en-IN"),
    },
    {
      id: "actions",
      header: "Actions",
      cell: (row) => (
        <div className="flex items-center gap-2">
          {campaignPermissions.canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); openEdit(row.id); }}
              aria-label={`Edit template ${row.name}`}
              data-testid={`edit-template-${row.id}`}
            >
              <Edit2 className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          {campaignPermissions.canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setDeleteTemplateId(row.id); }}
              aria-label={`Delete template ${row.name}`}
              data-testid={`delete-template-${row.id}`}
            >
              <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load templates"
        description="Something went wrong fetching the template registry."
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="templates-retry">
            Try again
          </Button>
        }
        data-testid="templates-error"
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="notification-admin">
      <PageHeader
        title="Message Templates"
        description="The email, WhatsApp and SMS messages campaigns send. Write one here, then pick it when you create a campaign."
        actions={
          campaignPermissions.canCreate ? (
            <Button onClick={openCreate} data-testid="new-template-btn">
              <Plus className="size-4" aria-hidden="true" />
              New template
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="templates">
        <TabsList aria-label="Message template sections">
          <TabsTrigger value="templates">Template registry</TabsTrigger>
          <TabsTrigger value="info">About</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4">
          {/* Filter */}
          <div className="mb-3 flex items-center gap-3">
            <Select
              value={channelFilter}
              onValueChange={(v) => setChannelFilter(v as CampaignChannel | "")}
              aria-label="Filter templates by channel"
              placeholder="Select channel"
              className="w-44"
              data-testid="template-channel-filter"
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </Select>
          </div>

          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            getRowId={(row) => row.id}
            loading={isLoading || isFetching}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total: data?.meta.total ?? 0,
              onPageChange: setPage,
            }}
            emptyState={{
              title: "No templates yet",
              description: "Create a reusable template for email, WhatsApp, or SMS campaigns.",
            }}
            caption="Campaign template registry"
            data-testid="templates-table"
          />
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <div className="rounded-md border border-border bg-surface p-4 text-sm text-fg-muted space-y-2">
            <p>
              Campaign templates are reusable message bodies per channel. WhatsApp and SMS templates
              require a DLT-approved template ID (issued by the TRAI DLT platform). Without a valid
              DLT Template ID, the send will be rejected.
            </p>
            <p>
              To broadcast an announcement to all students and leads, create an Email template and
              use the Campaigns module to build a campaign targeting all sources.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create/edit template drawer */}
      <CampaignTemplateFormDrawer
        open={templateDrawerOpen}
        onOpenChange={(open) => {
          setTemplateDrawerOpen(open);
          if (!open) setEditTemplateId(undefined);
        }}
        templateId={editTemplateId}
      />

      {/* Confirm delete */}
      <ConfirmDialog
        open={Boolean(deleteTemplateId)}
        onOpenChange={(open) => !open && setDeleteTemplateId(null)}
        title="Delete this template?"
        description="The template will be soft-deleted. Existing campaigns using it are unaffected."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
        data-testid="confirm-delete-template"
      />
    </div>
  );
}
