// The shared leave calendar: holidays, weekly offs, and who is out.
//
// WHY MULTI-DAY LEAVE IS EXPANDED INTO ONE EVENT PER DAY. The @repo/ui `Calendar` renders
// events into the day cell they start in and has no span rendering, so a five-day absence
// declared as one event would appear on the Monday and vanish for the rest of the week —
// exactly the days somebody checking cover needs to see. Expanding it here keeps the
// aggregation in the hook layer and the component presentational, the same split the LMS
// calendar uses.
//
// WHY WEEKLY OFFS AND HOLIDAYS ARE A TINT AND NOT EVENTS. Fifty-two Sundays a year would
// exhaust the grid's two-events-per-day slots and push real absences behind a "+N more".
// The `dayTone`/`dayLabel` props exist for this; the label carries the same information to
// a screen reader, so colour is never the only signal.
//
// There is no reason text anywhere on this screen, at any permission level. The calendar
// answers "who is off on Thursday", which the team needs in order to plan around it. Why
// they are off is between them and the approver.
import * as React from "react";
import {
  Alert,
  Button,
  Calendar,
  type CalendarDayTone,
  type CalendarEvent,
  PageHeader,
  Select,
  SelectItem,
} from "@repo/ui";
import type { LeaveCalendarResponse } from "@repo/types";

import { useLeaveCalendar } from "../../hooks/use-leave";

type Audience = "everyone" | "me";

const MS_PER_DAY = 86_400_000;

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function monthBounds(anchor: Date): { from: string; to: string } {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  // The grid shows adjacent-month days, so the window is padded a week either side —
  // otherwise an absence that starts in late July is invisible in the August view's
  // leading cells.
  const from = Date.UTC(year, month, 1) - 7 * MS_PER_DAY;
  const to = Date.UTC(year, month + 1, 0) + 7 * MS_PER_DAY;
  return { from: isoDate(from), to: isoDate(to) };
}

/**
 * One event per day an absence actually covers. Weekly offs and holidays inside the range
 * are skipped — the person is not "on leave" on a Sunday, and marking them so would make the
 * calendar disagree with the day count they were charged.
 */
export function expandLeaveEntries(
  data: LeaveCalendarResponse | undefined,
  audience: Audience,
): CalendarEvent[] {
  if (!data) return [];

  const offs = new Set(data.weeklyOffDays);
  const holidays = new Set(data.holidays.filter((h) => !h.optional).map((h) => h.date));
  const events: CalendarEvent[] = [];

  for (const entry of data.entries) {
    if (audience === "me" && !entry.isSelf) continue;

    const start = Date.parse(`${entry.startDate}T00:00:00.000Z`);
    const end = Date.parse(`${entry.endDate}T00:00:00.000Z`);

    for (let ts = start; ts <= end; ts += MS_PER_DAY) {
      const day = isoDate(ts);
      if (offs.has(new Date(ts).getUTCDay())) continue;
      if (holidays.has(day)) continue;

      events.push({
        id: `${entry.id}:${day}`,
        title: `${entry.userName} · ${entry.leaveTypeName}`,
        start: new Date(`${day}T00:00:00`),
        allDay: true,
        // Reuses the live-class status vocabulary the Calendar already tones by: an approved
        // absence is settled, one still awaiting a decision is not.
        status: entry.status === "approved" ? "completed" : "scheduled",
      });
    }
  }

  return events;
}

export function LeaveCalendarWorkspace(): React.JSX.Element {
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [audience, setAudience] = React.useState<Audience>("everyone");

  const bounds = React.useMemo(() => monthBounds(anchor), [anchor]);
  const query = useLeaveCalendar(bounds);

  const events = React.useMemo(() => expandLeaveEntries(query.data, audience), [query.data, audience]);

  const weeklyOffs = React.useMemo(() => new Set(query.data?.weeklyOffDays ?? []), [query.data]);
  const holidaysByDate = React.useMemo(
    () => new Map((query.data?.holidays ?? []).map((h) => [h.date, h])),
    [query.data],
  );

  const dayTone = React.useCallback(
    (date: Date): CalendarDayTone => {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
      const holiday = holidaysByDate.get(key);
      // An optional holiday is highlighted rather than shaded: it is still a working day, and
      // shading it would say the opposite of what the leave maths does.
      if (holiday) return holiday.optional ? "highlight" : "nonWorking";
      if (weeklyOffs.has(date.getDay())) return "nonWorking";
      return "default";
    },
    [holidaysByDate, weeklyOffs],
  );

  const dayLabel = React.useCallback(
    (date: Date): string | undefined => {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
      const holiday = holidaysByDate.get(key);
      if (holiday) return `${holiday.optional ? "optional holiday" : "holiday"}: ${holiday.name}`;
      if (weeklyOffs.has(date.getDay())) return "weekly off";
      return undefined;
    },
    [holidaysByDate, weeklyOffs],
  );

  return (
    <div className="space-y-4 md:space-y-5" data-testid="leave-calendar-workspace">
      <PageHeader
        title="Leave calendar"
        description="Company holidays, weekly offs, and who's away. Reasons stay private."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Show"
          value={audience}
          onValueChange={(value) => setAudience(value as Audience)}
          wrapperClassName="w-48"
          data-testid="leave-calendar-audience"
        >
          <SelectItem value="everyone">Everyone</SelectItem>
          <SelectItem value="me">Just me</SelectItem>
        </Select>
      </div>

      {query.isError ? (
        <Alert tone="danger" data-testid="leave-calendar-error">
          The calendar couldn&apos;t be loaded. Reload the page to try again.
        </Alert>
      ) : (
        <Calendar
          events={events}
          loading={query.isLoading}
          anchorDate={anchor}
          onMonthChange={setAnchor}
          dayTone={dayTone}
          dayLabel={dayLabel}
          timezoneLabel="IST"
          data-testid="leave-calendar"
        />
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted" data-testid="leave-calendar-legend">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-border bg-surface" aria-hidden="true" />
          Weekly off or holiday
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-warning/30 bg-warning/10" aria-hidden="true" />
          Optional holiday, still a working day
        </span>
      </div>
    </div>
  );
}
