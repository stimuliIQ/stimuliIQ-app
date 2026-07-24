// Minimal iCalendar (.ics) export — Phase 9 Completion, T35
// (docs/plans/phase-9-completion.md, docs/02 §7.7 "unified calendar ... iCal export").
//
// Deliberately hand-rolled (no `ics` npm package): the phase-9 plan flags `ics` as a
// "new dep — ask before install" item (decision #6) that has not been confirmed, and
// the RFC 5545 VEVENT shape needed here (SUMMARY/DTSTART/DTEND/LOCATION/DESCRIPTION/UID)
// is small enough to build directly from a `CalendarEvent` (@repo/ui) without a dependency.
// The @repo/ui `Calendar` component's `onExportEvent` seam is exactly this: "the mapping
// to an .ics file happens in the consuming app."
import type { CalendarEvent } from "@repo/ui";

function toIcsDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  // UTC, basic format: YYYYMMDDTHHMMSSZ (RFC 5545 §3.3.5)
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escapes text per RFC 5545 §3.3.11 (comma, semicolon, backslash, newline). */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Builds a single-event RFC 5545 .ics document from a @repo/ui CalendarEvent. */
export function buildIcsForEvent(event: CalendarEvent): string {
  const start = toIcsDate(event.start);
  const end = event.end ? toIcsDate(event.end) : toIcsDate(new Date(new Date(event.start).getTime() + 60 * 60_000));
  const now = toIcsDate(new Date());
  const uid = `${event.id}@stimuliiq.com`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//stimuliiq//LMS Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  // RFC 5545 §3.1 requires CRLF line endings.
  return lines.join("\r\n");
}

/** Slugifies an event title into a safe filename base. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "event";
}

/** Triggers a browser download of the event as a .ics file. Client-only. */
export function downloadIcsForEvent(event: CalendarEvent): void {
  if (typeof window === "undefined") return;
  const ics = buildIcsForEvent(event);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(event.title)}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
