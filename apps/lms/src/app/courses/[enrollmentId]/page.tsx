// Course detail + curriculum route (/courses/[enrollmentId]).
// Enrollment-gated: the API returns 403 if the enrollment doesn't belong
// to the authenticated student. The UI surfaces this as "Course not found."
// (docs/plans/phase-3.md task #7 — RBAC-aware enrollment-scoped UI)
import type { Metadata } from "next";

import { LmsShell } from "../../../components/shell/lms-shell";
import { CourseDetailContent } from "../../../components/courses/course-detail-content";

export const metadata: Metadata = {
  title: "Course — stimuliiq",
};

interface Props {
  params: Promise<{ enrollmentId: string }>;
}

export default async function CourseDetailPage({ params }: Props) {
  const { enrollmentId } = await params;
  return (
    <LmsShell wide>
      <CourseDetailContent enrollmentId={enrollmentId} />
    </LmsShell>
  );
}
