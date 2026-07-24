// Human-readable copy for NotificationDto records.
//
// Notifications arrive as a `type` discriminator plus an untyped `payload` bag,
// so the display strings are derived rather than stored. This lived inline in
// lms-shell.tsx until the course context panel's Activity tab needed the same
// titles — keeping one copy means the bell and the panel can never drift.

export function deriveNotificationTitle(
  type: string,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "grade_ready":
      return `Assignment graded: ${String(payload.assignmentTitle ?? "your assignment")}`;
    case "certificate_ready":
      return `Certificate ready: ${String(payload.programTitle ?? "your program")}`;
    case "forum_reply":
      return `New reply in: ${String(payload.threadTitle ?? "your thread")}`;
    case "announcement":
      return String(payload.title ?? "New announcement");
    case "lead_confirmation":
      return "Your enquiry has been received";
    case "booking_confirmation":
      return `Booking confirmed: ${String(payload.programTitle ?? "your session")}`;
    case "payment_receipt":
      return "Payment receipt available";
    case "welcome":
      return `Welcome, ${String(payload.userName ?? "there")}!`;
    default:
      return "New notification";
  }
}

export function deriveNotificationBody(
  payload: Record<string, unknown>,
): string | undefined {
  if (payload.body) return String(payload.body);
  if (payload.score !== undefined) return `Score: ${String(payload.score)}`;
  if (payload.slotDate) return `Date: ${String(payload.slotDate)}`;
  return undefined;
}
