"use client";

import * as React from "react";
import { Paperclip, Send } from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { RenderSink } from "./render-sink";
import { Select, SelectItem } from "./select";
import { Skeleton } from "./skeleton";
import { StatusChip } from "./status-chip";

/**
 * TicketThread — message list + composer for the support desk conversation view (T19,
 * docs/plans/phase-9-completion.md). Used by both the CRM agent workspace and the LMS
 * student ticket-detail page against the same shape.
 *
 * Message bodies are rendered through `RenderSink` (sink-level DOMPurify sanitization, per
 * docs/adr/0045) — the caller passes raw or already-sanitized HTML/plain text; XSS
 * protection happens here, at the render sink, not at the caller.
 *
 * Presentational/dumb, like `PostThread`/`DataTable`: no data fetching. The composer keeps
 * its own local draft text state (matching `FileUpload`'s pattern of owning only
 * interaction state) and calls `onSend` with the trimmed body on submit.
 *
 * a11y:
 * - Message list is `role="log"` with `aria-live="polite"` so new messages are announced
 *   without disrupting focus (standard chat-UI pattern).
 * - Each message is an `<article>` with an `aria-label` identifying the author and role.
 * - Internal notes (`isInternalNote`) get a visible "Internal note" badge — never
 *   color-only — plus a distinct background for quick visual scanning.
 * - Composer textarea has an associated label (`aria-label` or `label` prop); the send
 *   button is disabled (not hidden) while empty/sending, with `aria-busy` while sending.
 * - Canned-response insertion uses the existing accessible `Select`.
 *
 * Usage (CRM agent view):
 *   <TicketThread
 *     messages={ticket.messages}
 *     currentUserRole="agent"
 *     allowInternalNotes
 *     cannedResponses={canned}
 *     onSend={(body, opts) => sendMessage({ ticketId, body, internal: opts?.internal })}
 *     sending={isSending}
 *   />
 *
 * Usage (LMS student view):
 *   <TicketThread messages={ticket.messages} currentUserRole="customer" onSend={sendReply} />
 */

export type TicketMessageAuthorRole = "customer" | "agent" | "system";

export interface TicketMessage {
  id: string;
  authorId: string;
  authorDisplayName: string;
  authorRole: TicketMessageAuthorRole;
  /** Raw or pre-sanitized HTML/plain text — sanitized at render via `RenderSink`. */
  body: string;
  createdAt: Date | string;
  attachments?: Array<{ id: string; name: string; url?: string }>;
  /** Agent-only private note, not visible to the customer (CRM). */
  isInternalNote?: boolean;
}

export interface TicketCannedResponse {
  id: string;
  label: string;
  body: string;
}

export interface TicketThreadProps {
  messages: TicketMessage[];
  currentUserRole?: TicketMessageAuthorRole;
  onSend?: (body: string, opts?: { internal?: boolean }) => void | Promise<void>;
  sending?: boolean;
  /** Shows the "Internal note" toggle in the composer (agent/CRM surface only). */
  allowInternalNotes?: boolean;
  cannedResponses?: TicketCannedResponse[];
  loading?: boolean;
  error?: string;
  /** Disables the composer (e.g. ticket closed/resolved). */
  disabled?: boolean;
  disabledReason?: string;
  composerLabel?: string;
  /**
   * Overrides the per-role badge text. Defaults suit the CRM/agent surface
   * ("Customer"/"Agent"), which reads wrong on the student's own LMS thread —
   * a student looking at their own message is not a "Customer". Partial: any
   * role left out keeps its default.
   */
  roleLabels?: Partial<Record<TicketMessageAuthorRole, string>>;
  className?: string;
  /** Test hook; defaults to "ticket-thread" when omitted. */
  "data-testid"?: string;
}

function formatTimestamp(ts: Date | string): { label: string; iso: string } {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  return {
    label: date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
    iso: date.toISOString(),
  };
}

const ROLE_TONE: Record<TicketMessageAuthorRole, "info" | "success" | "neutral"> = {
  customer: "info",
  agent: "success",
  system: "neutral",
};

const ROLE_LABEL: Record<TicketMessageAuthorRole, string> = {
  customer: "Customer",
  agent: "Agent",
  system: "System",
};

export function TicketThread({
  messages,
  currentUserRole,
  onSend,
  sending = false,
  allowInternalNotes = false,
  cannedResponses,
  loading = false,
  error,
  disabled = false,
  disabledReason,
  composerLabel = "Write a reply",
  roleLabels,
  className,
  "data-testid": testId,
}: TicketThreadProps): React.JSX.Element {
  const labelFor = React.useCallback(
    (role: TicketMessageAuthorRole): string => roleLabels?.[role] ?? ROLE_LABEL[role],
    [roleLabels],
  );
  const [draft, setDraft] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !onSend) return;
    await onSend(trimmed, allowInternalNotes ? { internal: isInternal } : undefined);
    setDraft("");
    setIsInternal(false);
  }

  if (loading) {
    return (
      <div data-testid={testId ?? "ticket-thread"} aria-busy="true" aria-label="Loading conversation" className={cn("flex flex-col gap-4", className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-md border border-border p-3">
            <Skeleton shape="line" className="mb-2 w-1/3" />
            <Skeleton shape="line" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid={testId ?? "ticket-thread"} role="alert" className={cn("rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger", className)}>
        {error}
      </div>
    );
  }

  return (
    <div data-testid={testId ?? "ticket-thread"} className={cn("flex flex-col gap-4", className)}>
      {/* Message list */}
      {messages.length === 0 ? (
        <EmptyState title="No messages yet" description="Replies to this ticket will appear here." />
      ) : (
        <ol
          role="log"
          aria-live="polite"
          aria-label="Ticket conversation"
          className="flex flex-col gap-3"
        >
          {messages.map((message) => {
            const { label: timeLabel, iso } = formatTimestamp(message.createdAt);
            const isOwn = currentUserRole ? message.authorRole === currentUserRole : false;
            return (
              <li key={message.id}>
                <article
                  data-testid="ticket-message"
                  data-message-id={message.id}
                  aria-label={`Message from ${message.authorDisplayName} (${labelFor(message.authorRole)})${message.isInternalNote ? ", internal note" : ""}`}
                  className={cn(
                    "rounded-md border p-3",
                    message.isInternalNote
                      ? "border-warning/30 bg-warning/10"
                      : isOwn
                        ? "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10"
                        : "border-border bg-card",
                  )}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span className="font-medium text-fg">{message.authorDisplayName}</span>
                    <StatusChip tone={ROLE_TONE[message.authorRole]} label={labelFor(message.authorRole)} size="sm" />
                    {message.isInternalNote ? <StatusChip tone="warning" label="Internal note" size="sm" /> : null}
                    <time dateTime={iso}>{timeLabel}</time>
                  </div>
                  <RenderSink html={message.body} data-testid={`ticket-message-body-${message.id}`} />
                  {message.attachments && message.attachments.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1" aria-label="Attachments">
                      {message.attachments.map((att) => (
                        <li key={att.id}>
                          <a
                            href={att.url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "inline-flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:underline",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                            )}
                          >
                            <Paperclip aria-hidden="true" className="size-3" />
                            {att.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>
      )}

      {/* Composer */}
      {onSend ? (
        disabled ? (
          <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
            {disabledReason ?? "This ticket is closed and no longer accepts replies."}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2" data-testid="ticket-composer">
            {cannedResponses && cannedResponses.length > 0 ? (
              <Select
                aria-label="Insert canned response"
                placeholder="Insert canned response…"
                onValueChange={(id) => {
                  const canned = cannedResponses.find((c) => c.id === id);
                  if (canned) setDraft((prev) => (prev ? `${prev}\n${canned.body}` : canned.body));
                }}
                data-testid="ticket-canned-response-select"
              >
                {cannedResponses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </Select>
            ) : null}

            <label htmlFor="ticket-composer-textarea" className="sr-only">
              {composerLabel}
            </label>
            <textarea
              id="ticket-composer-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={composerLabel}
              rows={3}
              disabled={sending}
              data-testid="ticket-composer-textarea"
              className={cn(
                "w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg",
                "placeholder:text-fg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />

            <div className="flex items-center justify-between gap-3">
              {allowInternalNotes ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    data-testid="ticket-internal-note-toggle"
                    className="size-4 rounded-sm border border-border"
                  />
                  Internal note (not visible to customer)
                </label>
              ) : (
                <span />
              )}

              <button
                type="submit"
                disabled={sending || draft.trim().length === 0}
                aria-busy={sending || undefined}
                data-testid="ticket-composer-send"
                className={cn(
                  "inline-flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-brand-foreground",
                  "transition-colors duration-fast hover:bg-brand-600",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <Send aria-hidden="true" className="size-4" />
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}

TicketThread.displayName = "TicketThread";
