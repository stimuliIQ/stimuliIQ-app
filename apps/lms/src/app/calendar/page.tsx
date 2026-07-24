// /calendar — Unified calendar (assignment deadlines) with iCal export.
// Phase 9 Completion, T35. docs/02 §7.7.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { PageHeader } from "@repo/ui";

import { LmsShell } from "../../components/shell/lms-shell";
import { CalendarContent } from "../../components/calendar/calendar-content";

export const metadata: Metadata = {
  title: "Calendar — stimuliiq",
  description: "Your assignment deadlines in one place.",
};

export default function CalendarPage() {
  return (
    <LmsShell>
      <div className="space-y-6 md:space-y-8" data-testid="calendar-page">
        <PageHeader
          title="Calendar"
          description="Your assignment deadlines in one place."
        />
        <CalendarContent />
      </div>
    </LmsShell>
  );
}
