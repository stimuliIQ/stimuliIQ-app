// Support tickets list — Phase 9 Completion, T36 (docs/plans/phase-9-completion.md,
// docs/02 §7.16 "support/help desk (raise ticket -> CRM, status tracking)").
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton, StatusChip } from "@repo/ui";
import type { TicketStatus, TicketSummary } from "@repo/types";

import { useMyTickets } from "../../hooks/use-tickets";
import { NewTicketForm } from "./new-ticket-form";

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

function TicketRow({ ticket }: { ticket: TicketSummary }): React.JSX.Element {
  return (
    <li data-testid={`ticket-row-${ticket.id}`}>
      <Link
        href={`/support/${ticket.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg line-clamp-1">{ticket.subject}</p>
          <p className="text-xs text-fg-muted">
            {new Date(ticket.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            {ticket.assigneeName ? ` · Assigned to ${ticket.assigneeName}` : ""}
          </p>
        </div>
        <StatusChip tone={STATUS_TONE[ticket.status]} label={STATUS_LABEL[ticket.status]} size="sm" />
      </Link>
    </li>
  );
}

export function TicketsListContent(): React.JSX.Element {
  const { tickets, isLoading, isSignedOut, isError, error, create, isCreating, createError, refetch } = useMyTickets({
    page: 1,
    pageSize: 50,
  });
  const [showNewForm, setShowNewForm] = React.useState(false);

  if (isLoading) {
    return (
      <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading tickets" className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} shape="block" className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (isSignedOut) {
    return (
      <Card data-testid="tickets-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to raise or view support tickets.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="tickets-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load your tickets</CardTitle>
          <CardDescription>{error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="tickets-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="tickets-list-content">
      <PageHeader
        title="Support"
        description="Raise a ticket or check the status of one you've already submitted."
        actions={
          <Button onClick={() => setShowNewForm((v) => !v)} data-testid="tickets-new-toggle">
            <Plus aria-hidden="true" className="size-4" />
            {showNewForm ? "Cancel" : "Raise a ticket"}
          </Button>
        }
      />

      {showNewForm ? (
        <NewTicketForm
          onSubmit={create}
          isSubmitting={isCreating}
          submitError={createError}
          onSuccess={() => setShowNewForm(false)}
        />
      ) : null}

      {tickets.length === 0 ? (
        <EmptyState
          data-testid="tickets-empty"
          title="No support tickets yet"
          description="Raise a ticket if you run into a technical issue or have a question for the team."
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Your support tickets" data-testid="tickets-list">
          {tickets.map((t) => (
            <TicketRow key={t.id} ticket={t} />
          ))}
        </ul>
      )}
    </div>
  );
}
