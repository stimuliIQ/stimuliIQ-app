// Unified calendar events — Phase 9 Completion, T35 (docs/plans/phase-9-completion.md,
// docs/02 §7.7 "unified calendar (deadlines, assessments)"). Aggregates the student's
// assignment due dates into @repo/ui `CalendarEvent[]`. Live Classes was dropped from
// the product — this hook no longer aggregates live-class sessions.
// Pure aggregation/derivation — no fetching of its own beyond composing the own-scope
// hook it depends on (CLAUDE.md §3: "no business logic in components").
"use client";

import * as React from "react";
import type { CalendarEvent } from "@repo/ui";

import { useMyAssignments } from "./use-assignments";

export interface UseCalendarEventsResult {
  events: CalendarEvent[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useCalendarEvents(): UseCalendarEventsResult {
  const assignments = useMyAssignments();

  const events = React.useMemo<CalendarEvent[]>(() => {
    const deadlineEvents: CalendarEvent[] = assignments.assignments
      .filter((a) => a.dueAt && (a.status === "assigned" || a.status === "overdue"))
      .map((a) => ({
        id: `deadline-${a.id}`,
        title: `Due: ${a.title}`,
        start: a.dueAt as string,
        allDay: true,
        status: a.status === "overdue" ? ("cancelled" as const) : ("scheduled" as const),
        description: `${a.lessonTitle} · max score ${a.maxScoreDisplay}`,
        url: `/assignments/${a.id}`,
      }));

    return deadlineEvents.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  }, [assignments.assignments]);

  return {
    events,
    isLoading: assignments.isLoading,
    isError: assignments.isError,
    refetch: () => {
      assignments.refetch();
    },
  };
}
