// Program curriculum for the marketing site — "see how they teach before you pay".
//
// Each module expands to its lessons. A lesson flagged as a FREE PREVIEW in the CRM
// (Academics → Courses → curriculum → eye toggle) renders as a play button that opens
// an inline player; every other lesson renders with a lock + "Enrol to unlock".
//
// SECURITY: the lock is a UI reflection, never the gate. The playback URL comes from
// GET /public/programs/:slug/lessons/:id/preview-url, which 404s unless the program is
// public+published AND the lesson is `isPreview` AND its video is ready. A visitor who
// hand-crafts a request for a paid lesson gets a 404 — there is no client-side bypass.
//
// CLAUDE.md §3: "no business logic in components" — the fetch lives in the hook below,
// which is the only place that talks to the SDK.
"use client";

import * as React from "react";
import type { PublicLessonStub, PublicModuleOutline } from "@repo/types";

import { apiClient } from "../../../lib/api-client";

/** Inline icons — lucide-react is not a web dependency, so no new package. */
function Play({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function Lock({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function X({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

interface CurriculumPreviewProps {
  programSlug: string;
  outline: PublicModuleOutline[];
  /** Where "Enrol to unlock" sends the visitor. */
  enrollHref: string;
}

interface PreviewState {
  lesson: PublicLessonStub;
  url: string | null;
  error: string | null;
}

const LESSON_ICON: Record<PublicLessonStub["type"], string> = {
  video: "Video",
  reading: "Reading",
  quiz: "Quiz",
  assignment: "Assignment",
};

export function CurriculumPreview({
  programSlug,
  outline,
  enrollHref,
}: CurriculumPreviewProps): React.JSX.Element {
  const sortedModules = React.useMemo(
    () => [...outline].sort((a, b) => a.order - b.order),
    [outline],
  );

  // First module open by default — a collapsed wall of modules hides the value.
  const [openModuleId, setOpenModuleId] = React.useState<string | null>(
    sortedModules[0]?.id ?? null,
  );
  const [preview, setPreview] = React.useState<PreviewState | null>(null);
  const [loadingLessonId, setLoadingLessonId] = React.useState<string | null>(null);

  const previewCount = sortedModules.reduce(
    (n, m) => n + m.lessons.filter((l) => l.isPreview).length,
    0,
  );

  // Escape closes the player (dialog a11y). Also stops the marketing popups from
  // trapping a visitor who just wants to get back to the page.
  React.useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  async function openPreview(lesson: PublicLessonStub): Promise<void> {
    setLoadingLessonId(lesson.id);
    try {
      const res = await apiClient.public.programs.getLessonPreviewUrl(programSlug, lesson.id);
      setPreview({ lesson, url: res.url, error: null });
    } catch {
      // A 404 here means "not previewable" (or the video isn't ready yet) — say that
      // plainly rather than leaking why.
      setPreview({
        lesson,
        url: null,
        error: "This preview isn't available right now. Please try again later.",
      });
    } finally {
      setLoadingLessonId(null);
    }
  }

  return (
    <section aria-labelledby="curriculum-heading" data-testid="curriculum-preview">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="curriculum-heading" className="text-2xl font-bold text-fg">
          Curriculum
        </h2>
        {previewCount > 0 ? (
          <p className="text-sm text-fg-muted" data-testid="curriculum-preview-count">
            <span className="font-medium text-success">{previewCount} free preview{previewCount === 1 ? "" : "s"}</span>{" "}
            — watch before you enrol
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3 list-none p-0 m-0">
        {sortedModules.map((mod, modIndex) => {
          const isOpen = mod.id === openModuleId;
          const lessons = [...mod.lessons].sort((a, b) => a.order - b.order);
          const panelId = `curriculum-module-${mod.id}`;

          return (
            <li key={mod.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <h3 className="m-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenModuleId(isOpen ? null : mod.id)}
                  data-testid="curriculum-module-trigger"
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-fg">
                      {modIndex + 1}. {mod.title}
                    </span>
                    <span className="mt-0.5 block text-sm text-fg-muted">
                      {lessons.length} lesson{lessons.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-5 shrink-0 text-fg-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </h3>

              {isOpen ? (
                <ol id={panelId} className="m-0 list-none border-t border-border p-0">
                  {lessons.map((lesson) => {
                    const canPreview = lesson.isPreview;
                    const isLoading = loadingLessonId === lesson.id;

                    return (
                      <li
                        key={lesson.id}
                        className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-b-0"
                        data-testid="curriculum-lesson"
                      >
                        {/* Leading affordance: play (free) vs lock (paid) */}
                        <span
                          aria-hidden="true"
                          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                            canPreview ? "bg-success/10 text-success" : "bg-surface text-fg-subtle"
                          }`}
                        >
                          {canPreview ? <Play className="size-4" /> : <Lock className="size-4" />}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-fg">{lesson.title}</span>
                          <span className="text-xs text-fg-muted">{LESSON_ICON[lesson.type]}</span>
                        </span>

                        {canPreview ? (
                          <button
                            type="button"
                            onClick={() => void openPreview(lesson)}
                            disabled={isLoading}
                            data-testid="curriculum-preview-play"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                          >
                            <Play aria-hidden="true" className="size-3" />
                            {isLoading ? "Loading…" : "Preview"}
                          </button>
                        ) : (
                          <span
                            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-subtle"
                            data-testid="curriculum-locked"
                          >
                            <Lock aria-hidden="true" className="size-3" />
                            Enrol to unlock
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Preview player — a lightweight modal so the visitor never leaves the page. */}
      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview: ${preview.lesson.title}`}
          // z-[100]: above the timed/exit-intent lead popups (Radix dialogs at z-50).
          // A visitor who deliberately opened a preview must not have it covered by a
          // marketing popup mid-play.
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreview(null)}
          data-testid="curriculum-preview-modal"
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-xl bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">{preview.lesson.title}</p>
                <p className="text-xs text-success">Free preview</p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
                data-testid="curriculum-preview-close"
                className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            {preview.url ? (
              // D4e (lint cleanup): this previously carried an
              // `eslint-disable-next-line jsx-a11y/media-has-caption` directive, but
              // `eslint-plugin-jsx-a11y` is not registered in this repo's flat ESLint
              // config (packages/config/eslint/*.js) — the directive referenced an
              // unresolvable rule and ESLint's flat config reports THAT as a hard error
              // ("Definition for rule ... was not found"), which is what was actually
              // failing `next build`'s lint step. Replaced with a plain rationale
              // comment (no active rule governs this today): caption tracks are served
              // inside the stream when the CRM has attached them; a marketing preview
              // has no separate VTT file to reference via a <track> here.
              <video
                src={preview.url}
                controls
                autoPlay
                playsInline
                className="aspect-video w-full bg-black"
                data-testid="curriculum-preview-video"
              />
            ) : (
              <p className="px-5 py-10 text-center text-sm text-fg-muted" role="alert">
                {preview.error}
              </p>
            )}

            <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
              <p className="text-xs text-fg-muted">Enjoying it? Get the full course.</p>
              <a
                href={enrollHref}
                className="inline-flex items-center rounded-full bg-fg px-4 py-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="curriculum-preview-enroll"
              >
                Enrol now
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
