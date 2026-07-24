// Leads ▸ My Work — the counsellor's single operational cockpit
// (lifecycle-redesign P2 consolidation). This is the "single My Leads view"
// the product brief asks sales to primarily work from: one page, three tabs,
// zero page-switching.
//
// It COMPOSES the three previously-separate Leads pages as tabs rather than
// rewriting them — each was a distinct cross-lead work-queue, so their logic is
// preserved verbatim:
//   • Priorities — CounsellingWorkspace: today's/overdue follow-ups + due
//     bookings + SLA-overdue leads (the at-a-glance "what needs me now").
//   • Follow-ups — TasksPage: the full task queue with overdue/today/upcoming
//     filters.
//   • Bookings   — BookingList: booking management (create + status moves).
//
// The old /leads/tasks and /leads/bookings routes now redirect here (their
// per-lead equivalents also live inside the lead-detail drawer). Nav goes from
// five Leads items to three (Pipeline · My Work · Contact Messages).
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { CounsellingWorkspace } from "./counselling-workspace";
import { TasksPage } from "./tasks-page";
import { BookingList } from "./booking-list";

interface LeadsWorkspaceProps {
  me: MeResponse | undefined;
}

export function LeadsWorkspace({ me }: LeadsWorkspaceProps): React.JSX.Element {
  return (
    <Tabs defaultValue="priorities">
      <TabsList aria-label="My work sections">
        <TabsTrigger value="priorities">Priorities</TabsTrigger>
        <TabsTrigger value="followups">Follow-ups</TabsTrigger>
        <TabsTrigger value="bookings">Bookings</TabsTrigger>
      </TabsList>
      <TabsContent value="priorities">
        <CounsellingWorkspace me={me} />
      </TabsContent>
      <TabsContent value="followups">
        <TasksPage me={me} />
      </TabsContent>
      <TabsContent value="bookings">
        <BookingList me={me} />
      </TabsContent>
    </Tabs>
  );
}
