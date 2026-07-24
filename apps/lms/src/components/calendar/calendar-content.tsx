// Unified calendar content — Phase 9 Completion, T35 (docs/plans/phase-9-completion.md,
// docs/02 §7.7 "unified calendar (deadlines, assessments), iCal export").
// Data aggregation lives in useCalendarEvents(); this component is presentation-only.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { CalendarX2, RefreshCw } from "lucide-react";
import { Button, Calendar, Card, CardDescription, CardFooter, CardHeader, CardTitle, type CalendarEvent } from "@repo/ui";

import { useCalendarEvents } from "../../hooks/use-calendar-events";
import { downloadIcsForEvent } from "../../lib/ics";

export function CalendarContent(): React.JSX.Element {
  const { events, isLoading, isError, refetch } = useCalendarEvents();
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);

  if (isError) {
    return (
      <Card data-testid="calendar-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load your calendar</CardTitle>
          <CardDescription>Your deadlines couldn&apos;t be loaded.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="calendar-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8" data-testid="calendar-content">
      <Calendar
        events={events}
        loading={isLoading}
        onEventClick={(e) => setSelected(e)}
        onExportEvent={(e) => downloadIcsForEvent(e)}
        timezoneLabel="IST"
        data-testid="lms-calendar"
      />

      {!isLoading && events.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted" data-testid="calendar-empty-hint">
          <CalendarX2 aria-hidden="true" className="size-4" />
          No deadlines yet. They&apos;ll show up here automatically.
        </p>
      ) : null}

      {selected ? (
        <Card data-testid="calendar-selected-event">
          <CardHeader>
            <CardTitle>{selected.title}</CardTitle>
            {selected.description ? <CardDescription>{selected.description}</CardDescription> : null}
          </CardHeader>
          <CardFooter className="flex items-center gap-3">
            {selected.url ? (
              <Button asChild size="sm">
                <a href={selected.url}>Open</a>
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => downloadIcsForEvent(selected)}>
              Add to calendar (.ics)
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
}
