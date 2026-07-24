// Lesson detail route (/lessons/[id]) — Wave 5a stub + Wave 5b seam.
//
// This route is created by Wave 5a so that navigation from the
// CurriculumAccordion (courses/[enrollmentId]) → lessons/[id] works immediately.
//
// Wave 5a renders:
//   - Lesson title + type + breadcrumb
//   - Video placeholder (with clear "Wave 5b mounts VideoPlayer here" seam)
//   - Reading content body (HTML or structured JSON from lesson.content)
//   - Resources list (metadata only)
//   - Prev / Next navigation
//
// Wave 5b wires:
//   - VideoPlayer component from @repo/ui
//   - useStreamUrl(lessonId) hook → GET /api/v1/lessons/:id/stream-url
//     (called on play, not on mount; URL never cached)
//   - useProgressReporting() hook → PUT progress + POST complete
//   - PWA service-worker app shell
//
// The ?t=<seconds> query param is read from the URL and passed to the lesson
// player as the resume position (set by the ContinueLearning card deep-link).
import type { Metadata } from "next";
import { Suspense } from "react";

import { LmsShell } from "../../../components/shell/lms-shell";
import { LessonDetailContent } from "../../../components/lessons/lesson-detail-content";
import { Skeleton } from "@repo/ui";

export const metadata: Metadata = {
  title: "Lesson — stimuliiq",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LessonPage({ params }: Props) {
  const { id } = await params;
  return (
    <LmsShell wide>
      {/*
       * Suspense is needed because LessonDetailContent calls useSearchParams()
       * which requires Suspense in Next.js 15 App Router (useSearchParams is a
       * CSR hook and deopts the segment to client-side rendering).
       */}
      <Suspense
        fallback={
          <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading lesson" className="space-y-4">
            <Skeleton shape="line" className="h-4 w-32" />
            <Skeleton shape="line" className="h-7 w-3/4" />
            <Skeleton shape="block" className="h-[200px] w-full rounded-lg" />
          </div>
        }
      >
        <LessonDetailContent lessonId={id} />
      </Suspense>
    </LmsShell>
  );
}
