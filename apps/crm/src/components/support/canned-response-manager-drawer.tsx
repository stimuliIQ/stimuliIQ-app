// Canned-response manager — a lightweight list + inline create/edit form,
// opened from the ticket queue toolbar. Phase 9 Completion T21/T38.
import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button, ConfirmDialog, Drawer, DrawerContent, DrawerBody, EmptyState, Input, Skeleton, Textarea, useToast } from "@repo/ui";
import type { CannedResponse, MeResponse } from "@repo/types";

import {
  useCannedResponsesList,
  useCreateCannedResponse,
  useDeleteCannedResponse,
  useUpdateCannedResponse,
} from "../../hooks/use-tickets";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

interface CannedResponseManagerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

export function CannedResponseManagerDrawer({ open, onOpenChange, me }: CannedResponseManagerDrawerProps): React.JSX.Element {
  const canManage = hasPermission(me?.permissions, "canned_responses.manage");
  const { data, isLoading, isError } = useCannedResponsesList({ page: 1, pageSize: 100 });
  const createCanned = useCreateCannedResponse();
  const updateCanned = useUpdateCannedResponse();
  const deleteCanned = useDeleteCannedResponse();
  const { toast } = useToast();

  const [editing, setEditing] = React.useState<CannedResponse | null>(null);
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [body, setBody] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  function startNew() {
    setEditing(null);
    setTitle("");
    setCategory("");
    setBody("");
  }

  function startEdit(canned: CannedResponse) {
    setEditing(canned);
    setTitle(canned.title);
    setCategory(canned.category ?? "");
    setBody(canned.body);
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateCanned.mutateAsync({ id: editing.id, body: { title, body, category: category || undefined } });
        toast({ title: "Canned response updated", variant: "success" });
      } else {
        await createCanned.mutateAsync({ title, body, category: category || undefined });
        toast({ title: "Canned response created", variant: "success" });
      }
      startNew();
    } catch (error) {
      surfaceError(toast, error, "Couldn't save this canned response");
    }
  }

  function handleDelete() {
    if (!deleteId) return;
    deleteCanned.mutate(deleteId, {
      onSuccess: () => {
        toast({ title: "Deleted", variant: "success" });
        if (editing?.id === deleteId) startNew();
        setDeleteId(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete", description: (err as Error).message, variant: "destructive" });
        setDeleteId(null);
      },
    });
  }

  const isPending = createCanned.isPending || updateCanned.isPending;

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent title="Canned responses" description="Reusable macros agents can insert into ticket replies." size="md" data-testid="canned-response-manager">
          <DrawerBody className="flex flex-col gap-4">
            {canManage ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Password reset instructions" data-testid="canned-response-title-input" />
                <Input label="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Account & Billing" data-testid="canned-response-category-input" />
                <Textarea
                  label="Body"
                  required
                  id="canned-response-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  placeholder="Write the reusable reply…"
                  data-testid="canned-response-body-input"
                />
                <div className="flex justify-end gap-2">
                  {editing ? (
                    <Button variant="ghost" size="sm" onClick={startNew}>
                      Cancel edit
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={handleSave}
                    loading={isPending}
                    disabled={!title.trim() || !body.trim()}
                    data-testid="canned-response-save"
                  >
                    {editing ? "Save changes" : "Create"}
                  </Button>
                </div>
              </div>
            ) : null}

            {isLoading ? (
              <Skeleton shape="block" className="h-32" />
            ) : isError ? (
              <p role="alert" className="text-sm text-danger">
                Couldn't load canned responses.
              </p>
            ) : (data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No canned responses yet" description="Create your first reusable reply above." />
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Canned responses">
                {(data?.items ?? []).map((canned) => (
                  <li key={canned.id} className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(canned)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border p-2.5 text-left hover:bg-surface"
                      data-testid={`canned-response-item-${canned.id}`}
                    >
                      <span className="text-sm font-medium text-fg">{canned.title}</span>
                      <span className="line-clamp-1 text-xs text-fg-muted">{canned.body}</span>
                    </button>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(canned.id);
                        }}
                        aria-label={`Delete canned response ${canned.title}`}
                        data-testid={`delete-canned-${canned.id}`}
                      >
                        <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this canned response?"
        description="It will be soft-deleted and no longer available to agents replying to tickets."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteCanned.isPending}
        data-testid="confirm-delete-canned"
      />
    </>
  );
}
