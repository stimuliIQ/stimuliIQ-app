// My Courses route (/courses) — lists all the student's enrolled programs.
// Client component that renders MyCoursesList which calls useMyCourses()
// → GET /api/v1/me/enrollments. Enrollment-scoped: server returns only
// the authenticated student's own enrollments.
import type { Metadata } from "next";

import { PageHeader } from "@repo/ui";

import { LmsShell } from "../../components/shell/lms-shell";
import { MyCoursesList } from "../../components/courses/my-courses-list";

export const metadata: Metadata = {
  title: "My Courses — stimuliiq",
  description: "All your enrolled programs and progress.",
};

export default function MyCoursesPage() {
  return (
    <LmsShell>
      <div className="space-y-6 md:space-y-8" data-testid="my-courses-page">
        <PageHeader title="My Courses" />
        <MyCoursesList />
      </div>
    </LmsShell>
  );
}
