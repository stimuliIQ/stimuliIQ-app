// Dashboard route (/) — student home with continue-learning, my courses, and progress.
// P3 Wave 5a replaces the P0 shell with a real dashboard powered by
// GET /api/v1/me/dashboard (client.lms.dashboard.get()).
//
// Mobile-first: this page is the first bottom-tab destination ("Home").
// The LmsShell handles the top bar + bottom tab nav so navigation persists
// across all routes.
//
// The P0 DashboardStatus component (dashboard-status.tsx) is superseded by
// DashboardContent; it is kept in src/components/ in case tests reference it.
import type { Metadata } from "next";

import { LmsShell } from "../components/shell/lms-shell";
import { DashboardContent } from "../components/dashboard/dashboard-content";

export const metadata: Metadata = {
  title: "Dashboard | stimuliiq",
  description: "Your learning dashboard: continue where you left off, track your progress.",
};

export default function DashboardPage() {
  return (
    <LmsShell wide>
      <DashboardContent />
    </LmsShell>
  );
}
