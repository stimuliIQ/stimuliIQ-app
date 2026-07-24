"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

/**
 * Calendar — month grid + agenda list for live classes and the unified LMS calendar
 * (T19, docs/plans/phase-9-completion.md). Presentational/dumb like `DataTable`: the
 * caller owns data-fetching and passes `events`; this component only renders + emits
 * navigation/selection callbacks.
 *
 * `CalendarEvent` is deliberately shaped close to the fields the `ics` package (approved
 * per docs/plans/phase-9-completion.md decision #6, installed at the app layer for iCal
 * export) needs: `title`, `start`, `end`, `location`, `description`, `url`. This package
 * does NOT depend on `ics` itself — the mapping to an `.ics` file happens in the consuming
 * app; `onExportEvent` is the seam a caller wires to that export.
 *
 * Keyboard navigation (month view) follows the WAI-ARIA APG date-grid pattern:
 * - Arrow keys move focus by day/week; Home/End jump to the first/last day of the week;
 *   PageUp/PageDown move by month (Shift+PageUp/PageDown by year).
 * - Enter/Space activates the focused day (selects it, calling `onDateSelect`).
 * - Roving tabindex: only the focused day is in the tab sequence (`tabIndex=0`); all
 *   others are `tabIndex=-1`. Moving focus across a month boundary calls `onMonthChange`.
 *
 * Agenda view is a flat list of events grouped by date, each event row keyboard-operable
 * (button semantics) and calling `onEventClick`.
 *
 * a11y:
 * - Month grid: `role="grid"` + `role="row"` + day cells `role="gridcell"` with
 *   `aria-selected` on the selected day and `aria-current="date"` on today.
 * - Event dots are never the only signal — each day cell's `aria-label` includes the
 *   event count ("3 events") and, on focus/agenda view, full event titles are text.
 * - View switch (Month/Agenda) reuses the existing `Tabs` primitive (Radix roving focus).
 *
 * Usage:
 *   <Calendar
 *     events={liveClasses}
 *     view={view}
 *     onViewChange={setView}
 *     anchorDate={anchorMonth}
 *     onMonthChange={setAnchorMonth}
 *     onEventClick={(e) => openJoinDialog(e)}
 *     onExportEvent={(e) => downloadIcs(e)}
 *   />
 */

export type CalendarView = "month" | "agenda";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date | string;
  end?: Date | string;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** Optional status for tone (e.g. live class scheduled/live/completed/cancelled). Never
   * the sole signal — always paired with the visible title/time. */
  status?: "scheduled" | "live" | "completed" | "cancelled";
  /** Join / detail link, if any. */
  url?: string;
}

export interface CalendarProps {
  events: ReadonlyArray<CalendarEvent>;
  view?: CalendarView;
  defaultView?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  /** The month currently displayed (any date within that month). Controlled. */
  anchorDate?: Date;
  defaultAnchorDate?: Date;
  onMonthChange?: (date: Date) => void;
  selectedDate?: Date | null;
  onDateSelect?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  /** Seam for "Add to calendar" — caller wires this to an `ics` export. */
  onExportEvent?: (event: CalendarEvent) => void;
  renderEvent?: (event: CalendarEvent) => React.ReactNode;
  /** 0 = Sunday (default), 1 = Monday. */
  weekStartsOn?: 0 | 1;
  loading?: boolean;
  error?: string;
  /** Shown next to the month label, e.g. "IST". Purely informational. */
  timezoneLabel?: string;
  className?: string;
  /** Test hook; defaults to "calendar" when omitted. */
  "data-testid"?: string;
}

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

function toDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function addMonths(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(1);
  next.setMonth(next.getMonth() + n);
  return next;
}

function startOfWeek(d: Date, weekStartsOn: 0 | 1): Date {
  const day = d.getDay();
  const diff = weekStartsOn === 1 ? (day === 0 ? -6 : 1 - day) : -day;
  return addDays(d, diff);
}

/** 6 weeks x 7 days grid covering the full month, per WAI-ARIA date-grid convention. */
function buildMonthMatrix(anchor: Date, weekStartsOn: 0 | 1): Date[][] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth, weekStartsOn);
  const weeks: Date[][] = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function eventsByDay(events: ReadonlyArray<CalendarEvent>): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dateKey(toDate(event.start));
    const bucket = map.get(key) ?? [];
    bucket.push(event);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => toDate(a.start).getTime() - toDate(b.start).getTime());
  }
  return map;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function Calendar({
  events,
  view: controlledView,
  defaultView = "month",
  onViewChange,
  anchorDate: controlledAnchor,
  defaultAnchorDate,
  onMonthChange,
  selectedDate = null,
  onDateSelect,
  onEventClick,
  onExportEvent,
  renderEvent,
  weekStartsOn = 0,
  loading = false,
  error,
  timezoneLabel,
  className,
  "data-testid": testId,
}: CalendarProps): React.JSX.Element {
  const [uncontrolledView, setUncontrolledView] = React.useState<CalendarView>(defaultView);
  const view = controlledView ?? uncontrolledView;

  const [uncontrolledAnchor, setUncontrolledAnchor] = React.useState<Date>(
    () => defaultAnchorDate ?? new Date(),
  );
  const anchorDate = controlledAnchor ?? uncontrolledAnchor;

  const [focusedDate, setFocusedDate] = React.useState<Date>(() => selectedDate ?? anchorDate);
  const cellRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  // Only steal DOM focus when navigation was keyboard-driven (never on mount/click — a
  // click already focuses the target button natively; auto-focusing on mount would be an
  // a11y anti-pattern). Set right before a keyboard-driven focusedDate change, consumed
  // by the effect below once the (possibly newly-rendered, post month-change) cell exists.
  const shouldMoveDomFocusRef = React.useRef(false);

  React.useEffect(() => {
    if (shouldMoveDomFocusRef.current) {
      shouldMoveDomFocusRef.current = false;
      cellRefs.current.get(dateKey(focusedDate))?.focus();
    }
  }, [focusedDate, anchorDate]);

  function changeView(next: CalendarView): void {
    setUncontrolledView(next);
    onViewChange?.(next);
  }

  function changeMonth(next: Date): void {
    setUncontrolledAnchor(next);
    onMonthChange?.(next);
  }

  function goToMonth(offset: number): void {
    changeMonth(addMonths(anchorDate, offset));
  }

  function goToToday(): void {
    const today = new Date();
    changeMonth(today);
    setFocusedDate(today);
    onDateSelect?.(today);
  }

  function selectDate(d: Date): void {
    setFocusedDate(d);
    if (d.getMonth() !== anchorDate.getMonth() || d.getFullYear() !== anchorDate.getFullYear()) {
      changeMonth(d);
    }
    onDateSelect?.(d);
  }

  function focusDate(d: Date): void {
    shouldMoveDomFocusRef.current = true;
    setFocusedDate(d);
    if (d.getMonth() !== anchorDate.getMonth() || d.getFullYear() !== anchorDate.getFullYear()) {
      changeMonth(d);
    }
  }

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    let next: Date | null = null;
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(focusedDate, -1);
        break;
      case "ArrowRight":
        next = addDays(focusedDate, 1);
        break;
      case "ArrowUp":
        next = addDays(focusedDate, -7);
        break;
      case "ArrowDown":
        next = addDays(focusedDate, 7);
        break;
      case "Home":
        next = startOfWeek(focusedDate, weekStartsOn);
        break;
      case "End":
        next = addDays(startOfWeek(focusedDate, weekStartsOn), 6);
        break;
      case "PageUp":
        next = e.shiftKey
          ? new Date(focusedDate.getFullYear() - 1, focusedDate.getMonth(), focusedDate.getDate())
          : addMonths(focusedDate, -1);
        break;
      case "PageDown":
        next = e.shiftKey
          ? new Date(focusedDate.getFullYear() + 1, focusedDate.getMonth(), focusedDate.getDate())
          : addMonths(focusedDate, 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectDate(focusedDate);
        return;
      default:
        return;
    }
    if (next) {
      e.preventDefault();
      focusDate(next);
    }
  }

  const byDay = React.useMemo(() => eventsByDay(events), [events]);
  const weeks = React.useMemo(() => buildMonthMatrix(anchorDate, weekStartsOn), [anchorDate, weekStartsOn]);
  const weekdayLabels = React.useMemo(() => {
    const rotated = [...WEEKDAY_LABELS_SUN.slice(weekStartsOn), ...WEEKDAY_LABELS_SUN.slice(0, weekStartsOn)];
    return rotated;
  }, [weekStartsOn]);

  const monthLabel = MONTH_LABEL_FMT.format(anchorDate);
  const today = new Date();

  if (loading) {
    return (
      <div data-testid={testId ?? "calendar"} aria-busy="true" aria-label="Loading calendar" className={cn("flex flex-col gap-3", className)}>
        <Skeleton shape="line" className="h-8 w-48" />
        <Skeleton shape="block" className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid={testId ?? "calendar"} role="alert" className={cn("rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger", className)}>
        {error}
      </div>
    );
  }

  return (
    <div data-testid={testId ?? "calendar"} className={cn("flex flex-col gap-4", className)}>
      {/* Header: navigation + view switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goToMonth(-1)}
            aria-label="Previous month"
            data-testid="calendar-prev-month"
            className={cn(
              "rounded-md p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <h2 className="min-w-[10rem] text-center text-base font-semibold text-fg" aria-live="polite">
            {monthLabel}
            {timezoneLabel ? <span className="ml-1.5 text-xs font-normal text-fg-muted">({timezoneLabel})</span> : null}
          </h2>
          <button
            type="button"
            onClick={() => goToMonth(1)}
            aria-label="Next month"
            data-testid="calendar-next-month"
            className={cn(
              "rounded-md p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            onClick={goToToday}
            data-testid="calendar-today"
            className={cn(
              "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-surface hover:text-fg transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Today
          </button>
        </div>

        <Tabs value={view} onValueChange={(v) => changeView(v as CalendarView)}>
          <TabsList aria-label="Calendar view">
            <TabsTrigger value="month" data-testid="calendar-view-month">Month</TabsTrigger>
            <TabsTrigger value="agenda" data-testid="calendar-view-agenda">Agenda</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "month" ? (
        <div
          role="grid"
          aria-label={`${monthLabel} calendar`}
          onKeyDown={handleGridKeyDown}
          className="overflow-hidden rounded-md border border-border"
        >
          <div role="row" className="grid grid-cols-7 border-b border-border bg-surface">
            {weekdayLabels.map((label) => (
              <div key={label} role="columnheader" className="px-2 py-2 text-center text-xs font-medium text-fg-muted">
                {label}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} role="row" className="grid grid-cols-7 border-b border-border last:border-0">
              {week.map((day) => {
                const key = dateKey(day);
                const dayEvents = byDay.get(key) ?? [];
                const isCurrentMonth = day.getMonth() === anchorDate.getMonth();
                const isToday = isSameDay(day, today);
                const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                const isFocusTarget = isSameDay(day, focusedDate);

                return (
                  <button
                    key={key}
                    ref={(el) => {
                      if (el) cellRefs.current.set(key, el);
                      else cellRefs.current.delete(key);
                    }}
                    type="button"
                    role="gridcell"
                    tabIndex={isFocusTarget ? 0 : -1}
                    aria-selected={isSelected || undefined}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${day.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${
                      dayEvents.length > 0 ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""
                    }`}
                    data-testid="calendar-day"
                    data-date={key}
                    onClick={() => selectDate(day)}
                    onFocus={() => setFocusedDate(day)}
                    className={cn(
                      "flex min-h-[5.5rem] flex-col items-start gap-1 border-r border-border p-1.5 text-left last:border-r-0",
                      "transition-colors duration-fast ease-out hover:bg-surface",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      !isCurrentMonth && "bg-surface/50 text-fg-subtle",
                      isSelected && "bg-brand-50 dark:bg-brand-500/10",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium",
                        isToday ? "bg-brand-500 text-brand-foreground" : "text-fg",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    <div className="flex w-full flex-col gap-0.5 overflow-hidden">
                      {dayEvents.slice(0, 2).map((event) =>
                        renderEvent ? (
                          <React.Fragment key={event.id}>{renderEvent(event)}</React.Fragment>
                        ) : (
                          <span
                            key={event.id}
                            className="truncate rounded-sm bg-brand-100 px-1 text-[0.65rem] font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                          >
                            {event.title}
                          </span>
                        ),
                      )}
                      {dayEvents.length > 2 ? (
                        <span className="text-[0.65rem] text-fg-muted">+{dayEvents.length - 2} more</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <AgendaList
          events={events}
          onEventClick={onEventClick}
          onExportEvent={onExportEvent}
          renderEvent={renderEvent}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda view
// ---------------------------------------------------------------------------

interface AgendaListProps {
  events: ReadonlyArray<CalendarEvent>;
  onEventClick?: (event: CalendarEvent) => void;
  onExportEvent?: (event: CalendarEvent) => void;
  renderEvent?: (event: CalendarEvent) => React.ReactNode;
}

function AgendaList({ events, onEventClick, onExportEvent, renderEvent }: AgendaListProps): React.JSX.Element {
  const sorted = [...events].sort((a, b) => toDate(a.start).getTime() - toDate(b.start).getTime());

  if (sorted.length === 0) {
    return <EmptyState title="No events scheduled" description="Upcoming live classes and events will appear here." />;
  }

  const groups: Array<{ key: string; label: string; items: CalendarEvent[] }> = [];
  for (const event of sorted) {
    const start = toDate(event.start);
    const key = dateKey(start);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        label: start.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(event);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="calendar-agenda">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h3 className="mb-2 text-sm font-semibold text-fg-muted">{group.label}</h3>
          <ol className="flex flex-col gap-2">
            {group.items.map((event) => {
              const start = toDate(event.start);
              const end = event.end ? toDate(event.end) : null;
              return (
                <li key={event.id}>
                  <div
                    className={cn(
                      "flex items-start gap-3 rounded-md border border-border bg-card p-3",
                      onEventClick && "cursor-pointer hover:bg-surface",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onEventClick?.(event)}
                      disabled={!onEventClick}
                      aria-label={`${event.title}, ${event.allDay ? "all day" : formatTime(start)}`}
                      data-testid={`calendar-agenda-event-${event.id}`}
                      className={cn(
                        "flex flex-1 flex-col items-start gap-1 text-left",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
                        !onEventClick && "cursor-default",
                      )}
                    >
                      {renderEvent ? (
                        renderEvent(event)
                      ) : (
                        <>
                          <span className="text-sm font-medium text-fg">{event.title}</span>
                          <span className="flex items-center gap-1 text-xs text-fg-muted">
                            <Clock aria-hidden="true" className="size-3" />
                            {event.allDay ? "All day" : end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start)}
                          </span>
                          {event.location ? (
                            <span className="flex items-center gap-1 text-xs text-fg-muted">
                              <MapPin aria-hidden="true" className="size-3" />
                              {event.location}
                            </span>
                          ) : null}
                        </>
                      )}
                    </button>
                    {onExportEvent ? (
                      <button
                        type="button"
                        onClick={() => onExportEvent(event)}
                        aria-label={`Add ${event.title} to calendar`}
                        data-testid={`calendar-export-${event.id}`}
                        className={cn(
                          "shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface hover:text-fg",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        Add to calendar
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
