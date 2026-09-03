// Campaign templates manager — lists reusable templates and lets staff create, edit, or
// delete them. Reuses CampaignTemplateFormDrawer for the create/edit form (RHF + zod +
// LOCK-D4 DLT enforcement) and the existing template hooks. Opened from the "Templates"
// button in the CampaignDirectory header — previously the form drawer was never surfaced,
// so there was no way to create a template from the UI.
import * as React from "react";
import { Plus, Pencil, Trash2, Mail, MessageCircle, Smartphone } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Skeleton,
  StatusChip,
  useToast,
} from "@repo/ui";
import type { CampaignChannel, CampaignTemplateDto } from "@repo/types";

import { useCampaignTemplatesList, useDeleteCampaignTemplate } from "../../hooks/use-campaigns";
import { CampaignTemplateFormDrawer } from "./campaign-template-form-drawer";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

interface CampaignTemplatesManagerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHANNEL_ICON: Record<CampaignChannel, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: MessageCircle,
  sms: Smartphone,
};

const CHANNEL_LABEL: Record<CampaignChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

function templateHasDlt(tpl: CampaignTemplateDto): boolean {
  return tpl.channel !== "email" && Boolean((tpl as { dltTemplateId?: string }).dltTemplateId);
}

export function CampaignTemplatesManagerDrawer({
  open,
  onOpenChange,
}: CampaignTemplatesManagerDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useCampaignTemplatesList({ pageSize: 100 });
  const deleteMutation = useDeleteCampaignTemplate();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = React.useState<CampaignTemplateDto | null>(null);

  const templates = data?.items ?? [];

  function openCreate() {
    setEditId(undefined);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setFormOpen(true);
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: "Template deleted", variant: "success" });
        setDeleteTarget(null);
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to delete template");
      },
    });
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          position="center"
          title="Campaign templates"
          description="Reusable message templates for email, WhatsApp, and SMS campaigns."
          data-testid="campaign-templates-manager"
        >
          <DrawerBody>
            <div className="mb-4 flex justify-end">
              <Button size="sm" onClick={openCreate} data-testid="new-template-btn">
                <Plus className="size-4" aria-hidden="true" />
                New template
              </Button>
            </div>

            {isLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading templates">
                <Skeleton shape="line" className="h-16" />
                <Skeleton shape="line" className="h-16" />
                <Skeleton shape="line" className="h-16" />
              </div>
            ) : isError ? (
              // "No templates yet" on a failed load reads as a fact and invites a duplicate.
              <EmptyState
                title="Couldn't load the templates"
                description={queryErrorMessage(error, "Something went wrong fetching the template list.")}
                action={
                  <Button size="sm" variant="secondary" onClick={() => refetch()} data-testid="templates-retry">
                    Try again
                  </Button>
                }
                data-testid="templates-error"
              />
            ) : templates.length === 0 ? (
              <EmptyState
                title="No templates yet"
                description="Create a reusable template to start building campaigns."
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="size-4" aria-hidden="true" />
                    New template
                  </Button>
                }
                data-testid="templates-empty"
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="templates-list">
                {templates.map((tpl) => {
                  const Icon = CHANNEL_ICON[tpl.channel];
                  const missingDlt = (tpl.channel === "whatsapp" || tpl.channel === "sms") && !templateHasDlt(tpl);
                  return (
                    <li
                      key={tpl.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                      data-testid={`template-row-${tpl.id}`}
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted"
                      >
                        <Icon className="size-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-fg">{tpl.name}</span>
                          <StatusChip
                            tone={tpl.channel === "email" ? "info" : tpl.channel === "whatsapp" ? "success" : "warning"}
                            label={CHANNEL_LABEL[tpl.channel]}
                            size="sm"
                          />
                          {missingDlt ? <StatusChip tone="danger" label="No DLT ID" size="sm" /> : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{tpl.body}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(tpl.id)}
                          aria-label={`Edit ${tpl.name}`}
                          data-testid={`edit-template-${tpl.id}`}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(tpl)}
                          aria-label={`Delete ${tpl.name}`}
                          data-testid={`delete-template-${tpl.id}`}
                        >
                          <Trash2 className="size-4 text-danger" aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DrawerBody>

          <DrawerFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} data-testid="templates-close-btn">
              Close
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Create / edit form (reused for both modes) */}
      <CampaignTemplateFormDrawer open={formOpen} onOpenChange={setFormOpen} templateId={editId} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this template?"
        description="It will be soft-deleted. Campaigns already sent with it are unaffected; you can't use it for new campaigns."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
        data-testid="confirm-delete-template"
      />
    </>
  );
}
