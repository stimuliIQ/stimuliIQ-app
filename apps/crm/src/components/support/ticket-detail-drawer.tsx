// Ticket detail drawer — TicketThread (message list + composer, internal
// notes, canned-response insertion) + status/priority/assignee editor.
// Phase 9 Completion T21/T38.
import * as React from "react";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  EmptyState,
  Select,
  SelectItem,
  Skeleton,
  SlaChip,
  TicketThread,
  useToast,
} from "@repo/ui";
import type { MeResponse, TicketPriority, TicketStatus } from "@repo/types";

import { useAddTicketMessage, useCannedResponsesList, useTicket, useUpdateTicket } from "../../hooks/use-tickets";
import { useFacultyList } from "../../hooks/use-faculty";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "resolved", "closed"];
const PRIORITY_OPTIONS: TicketPriority[] = ["low", "medium", "high", "urgent"];

interface TicketDetailDrawerProps {
  ticketId: string | null;
  onOpenChange: (open: boolean) => void;
  me: MeResponse | undefined;
}

export function TicketDetailDrawer({ ticketId, onOpenChange, me }: TicketDetailDrawerProps): React.JSX.Element {
  const open = Boolean(ticketId);
  const { data: ticket, isLoading, isError, refetch } = useTicket(ticketId ?? undefined);
  const { data: canned } = useCannedResponsesList({ page: 1, pageSize: 100 });
  const { data: staff } = useFacultyList({ page: 1, pageSize: 200, includeDeleted: false });
  const addMessage = useAddTicketMessage();
  const updateTicket = useUpdateTicket();
  const { toast } = useToast();
  const canManage = hasPermission(me?.permissions, "tickets.edit");

  async function handleSend(body: string, opts?: { internal?: boolean }) {
    if (!ticket) return;
    try {
      await addMessage.mutateAsync({ id: ticket.id, body: { body, isInternal: Boolean(opts?.internal) } });
    } catch (error) {
      surfaceError(toast, error, "Couldn't send this message");
    }
  }

  async function handleFieldChange(patch: { status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null }) {
    if (!ticket) return;
    try {
      await updateTicket.mutateAsync({ id: ticket.id, body: patch });
    } catch (error) {
      surfaceError(toast, error, "Couldn't update this ticket");
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={ticket?.subject ?? "Ticket"} description={ticket?.userName} size="lg" data-testid="ticket-detail-drawer">
        <DrawerBody className="flex flex-col gap-4">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton shape="line" />
              <Skeleton shape="block" />
            </div>
          ) : isError ? (
            <EmptyState
              title="Couldn't load this ticket"
              action={
                <Button variant="secondary" onClick={() => refetch()}>
                  Try again
                </Button>
              }
            />
          ) : !ticket ? (
            <EmptyState title="No data" />
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label="Status"
                  placeholder="Select status"
                  value={ticket.status}
                  onValueChange={(v) => handleFieldChange({ status: v as TicketStatus })}
                  disabled={!canManage}
                  wrapperClassName="w-40"
                  data-testid="ticket-status-select"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </Select>
                <Select
                  label="Priority"
                  placeholder="Select priority"
                  value={ticket.priority}
                  onValueChange={(v) => handleFieldChange({ priority: v as TicketPriority })}
                  disabled={!canManage}
                  wrapperClassName="w-36"
                  data-testid="ticket-priority-select"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </Select>
                <Select
                  label="Assignee"
                  placeholder="Unassigned"
                  value={ticket.assigneeId ?? undefined}
                  onValueChange={(v) => handleFieldChange({ assigneeId: v === "__unassigned__" ? null : v })}
                  disabled={!canManage}
                  wrapperClassName="w-48"
                  data-testid="ticket-assignee-select"
                >
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {(staff?.items ?? []).map((f) => (
                    <SelectItem key={f.userId} value={f.userId}>
                      {f.name}
                    </SelectItem>
                  ))}
                </Select>
                {ticket.slaDueAt ? <SlaChip dueAt={new Date(ticket.slaDueAt)} /> : null}
              </div>

              <TicketThread
                messages={ticket.messages.map((m) => ({
                  id: m.id,
                  authorId: m.authorId,
                  authorDisplayName: m.authorName,
                  authorRole: m.authorId === ticket.userId ? "customer" : "agent",
                  body: m.body,
                  createdAt: m.createdAt,
                  isInternalNote: m.isInternal,
                }))}
                currentUserRole="agent"
                allowInternalNotes
                cannedResponses={(canned?.items ?? []).map((c) => ({ id: c.id, label: c.title, body: c.body }))}
                onSend={handleSend}
                sending={addMessage.isPending}
                disabled={ticket.status === "closed"}
                data-testid="ticket-thread"
              />
            </>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
