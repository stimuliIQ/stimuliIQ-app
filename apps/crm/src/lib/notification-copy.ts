// Human-readable copy for a CRM NotificationDto.
//
// A notification arrives as a `type` discriminator plus an untyped `payload` bag, so the
// display strings are derived at render time rather than stored — which is what lets the
// wording change without a migration over historic rows.
//
// The CRM's vocabulary is deliberately NOT the LMS's (apps/lms/src/lib/notification-copy.ts).
// A student reads "Your enquiry has been received"; a staff member reading the same row
// needs "Priya Sharma — from the website". Sharing one file would force one voice on both
// audiences, so the two are separate on purpose.

/** A notification's headline. Unknown types degrade to a generic title rather than throwing. */
export function deriveNotificationTitle(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "lead_assigned":
      // Lead FIRST: this is a work queue, and the name is what the rep scans for.
      return `New lead: ${String(payload.leadName ?? "Unnamed lead")}`;
    case "announcement":
      return String(payload.title ?? "New announcement");
    case "forum_reply":
      return `New reply in: ${String(payload.threadTitle ?? "a thread")}`;
    case "booking_confirmation":
      return `Booking confirmed: ${String(payload.programTitle ?? "a session")}`;
    case "payment_receipt":
      return "Payment receipt available";
    case "certificate_ready":
      return `Certificate ready: ${String(payload.programTitle ?? "a program")}`;
    case "grade_ready":
      return `Assignment graded: ${String(payload.assignmentTitle ?? "an assignment")}`;
    default:
      return "New notification";
  }
}

/** The supporting line. For an assigned lead this is the phone number — the thing that makes the row actionable without opening it. */
export function deriveNotificationBody(type: string, payload: Record<string, unknown>): string | undefined {
  if (type === "lead_assigned") {
    const parts = [
      payload.leadPhone ? String(payload.leadPhone) : null,
      payload.leadSource ? `via ${String(payload.leadSource)}` : null,
      payload.assignedByName ? `· ${String(payload.assignedByName)}` : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
  if (payload.body) return String(payload.body);
  if (payload.score !== undefined) return `Score: ${String(payload.score)}`;
  return undefined;
}
