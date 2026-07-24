// Ticket detail — Phase 9 Completion, T36 (docs/plans/phase-9-completion.md).
// Uses the shared TicketThread primitive (@repo/ui) — the same component the CRM
// agent workspace uses (T38), against the same message shape.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Star } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  StatusChip,
  TicketThread,
  type TicketMessage,
} from "@repo/ui";
import type { TicketStatus } from "@repo/types";

import { useTicketDetail } from "../../hooks/use-tickets";

const STATUS_TONE: Record<TicketStatus, "info" | "warning" | "success" | "neutral"> = {
  open: "info",
  in_progress: "warning",
  resolved: "success",
  closed: "neutral",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

function RatingPrompt({
  onRate,
  isRating,
  currentRating,
}: {
  onRate: (rating: number) => void;
  isRating: boolean;
  currentRating: number | null;
}): React.JSX.Element {
  return (
    <Card data-testid="ticket-rating-card">
      <CardHeader>
        <CardTitle className="text-base">
          {currentRating ? "Thanks for rating this ticket" : "How was your support experience?"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Rate this ticket" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={currentRating === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => onRate(n)}
              disabled={isRating || currentRating != null}
              data-testid={`ticket-rate-${n}`}
              className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <Star
                aria-hidden="true"
                className={
                  currentRating != null && n <= currentRating
                    ? "size-5 fill-warning text-warning"
                    : "size-5 text-fg-subtle"
                }
              />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export interface TicketDetailContentProps {
  ticketId: string;
}

export function TicketDetailContent({ ticketId }: TicketDetailContentProps): React.JSX.Element {
  const { ticket, isLoading, isSignedOut, isForbidden, isError, error, addMessage, isSending, rate, isRating, refetch } =
    useTicketDetail(ticketId);

  if (isSignedOut) {
    return (
      <Card data-testid="ticket-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view this ticket.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isForbidden) {
    return (
      <EmptyState
        data-testid="ticket-not-found"
        title="Ticket not found"
        description="This ticket doesn't exist or doesn't belong to you."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/support">Back to Support</Link>
          </Button>
        }
      />
    );
  }

  if (isLoading) {
    return (
      <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading ticket" className="space-y-4">
        <Skeleton shape="line" className="h-6 w-2/3" />
        <Skeleton shape="block" className="h-32 w-full rounded-md" />
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <Card data-testid="ticket-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load this ticket</CardTitle>
          <CardDescription>{error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="ticket-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const messages: TicketMessage[] = [
    {
      id: `${ticket.id}-original`,
      authorId: ticket.userId,
      authorDisplayName: ticket.userName,
      authorRole: "customer",
      body: ticket.body,
      createdAt: ticket.createdAt,
    },
    ...ticket.messages.map<TicketMessage>((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorDisplayName: m.authorName,
      authorRole: m.authorId === ticket.userId ? "customer" : "agent",
      body: m.body,
      createdAt: m.createdAt,
    })),
  ];

  const isClosed = ticket.status === "closed";
  const canRate = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <div className="space-y-6" data-testid="ticket-detail-content">
      <Link
        href="/support"
        className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        data-testid="back-to-support"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to Support
      </Link>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-fg flex-1 min-w-0">{ticket.subject}</h1>
          <StatusChip tone={STATUS_TONE[ticket.status]} label={STATUS_LABEL[ticket.status]} size="sm" />
        </div>
        {ticket.slaDueAt ? (
          <p className="text-xs text-fg-muted">
            Target response by {new Date(ticket.slaDueAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </p>
        ) : null}
      </div>

      <TicketThread
        messages={messages}
        currentUserRole="customer"
        // The shared defaults ("Customer"/"Agent") are written for the CRM agent
        // looking at someone else's ticket. On the student's own thread the
        // student is not a "Customer" — they're themselves, replying to support.
        roleLabels={{ customer: "You", agent: "Support" }}
        onSend={async (body) => {
          await addMessage({ body, isInternal: false });
        }}
        sending={isSending}
        disabled={isClosed}
        disabledReason="This ticket is closed and no longer accepts replies."
        data-testid="ticket-thread"
      />

      {canRate ? (
        <RatingPrompt onRate={(n) => void rate({ rating: n })} isRating={isRating} currentRating={ticket.rating} />
      ) : null}
    </div>
  );
}
