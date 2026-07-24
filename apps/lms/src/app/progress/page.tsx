// My Progress route (/progress) — Wave 5b build-out.
//
// Replaces the Wave 5a stub with the real progress view:
//   - Per-program ProgressRing + module ProgressBar breakdown
//   - useMyProgress() hook → GET /api/v1/me/progress (MyProgressResponse)
//   - Attendance summary → GET /api/v1/me/attendance (MyAttendanceResponse)
//   - Loading / empty / error states
//   - Signed-out redirect-prompt
import type { Metadata } from "next";

import { PageHeader } from "@repo/ui";

import { LmsShell } from "../../components/shell/lms-shell";
import { ProgressContent } from "../../components/progress/progress-content";

export const metadata: Metadata = {
  title: "My Progress — stimuliiq",
  description: "Track your lesson completion, module progress, and attendance across all enrolled programs.",
};

export default function ProgressPage() {
  return (
    <LmsShell>
      <div className="space-y-6 md:space-y-8" data-testid="progress-page">
        <PageHeader
          title="My Progress"
          description="Your lesson completion, module progress, and attendance across all programs."
        />
        <ProgressContent />
      </div>
    </LmsShell>
  );
}
