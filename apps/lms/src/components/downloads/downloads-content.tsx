// Downloads page content — the student's OFFLINE LIBRARY.
//
// SCOPE (narrowed 2026-07-18): this page shows saved-for-offline lessons and
// nothing else. It previously also carried a resource keyword search AND a
// browse-by-course tree, which made one page read as three unrelated tools and
// pushed the offline list — the thing a student opens Downloads for — below two
// panels that require a network connection, i.e. useless in exactly the situation
// this page exists to serve.
//
// Nothing was lost by narrowing it:
//   · Lesson attachments (PDF/slides/datasets) render on each lesson under
//     RESOURCES, in the context where a student actually looks for them.
//   · Cross-course resource search lives in the top-bar global search (/search),
//     which already indexes lessons, resources, and forum posts.
"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";
import { PageHeader } from "@repo/ui";

import { OfflineLessonsPanel } from "./offline-lessons-panel";

export function DownloadsContent(): React.JSX.Element {
  return (
    <div className="space-y-6 md:space-y-8" data-testid="downloads-content">
      <PageHeader
        title="Downloads"
        description={
          <span className="flex items-center gap-1.5">
            <WifiOff aria-hidden="true" className="size-4" />
            Lessons you&apos;ve saved to watch without internet.
          </span>
        }
      />

      <OfflineLessonsPanel />
    </div>
  );
}
