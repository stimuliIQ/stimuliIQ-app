// LessonNotesPanel — personal notes at video timestamps. Phase 9 Completion, T36
// (docs/plans/phase-9-completion.md, docs/02 §7.3 "notes/bookmarks at timestamps").
//
// Timestamp anchoring: LessonVideoPlayer does not currently surface a live
// "current playback second" up to the lesson page (its onTimeUpdate feeds
// progress-reporting only — see lesson-video-player.tsx, which this task does not
// modify per the B4/hls.js "already done" note). As a practical anchor, "At current
// position" uses the last-synced progress position (`lesson.progress.lastPositionS`,
// updated every ~10s during playback) — the same value the player itself resumes
// from. A student can also type an exact mm:ss.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Clock, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Button, Checkbox, EmptyState, Skeleton } from "@repo/ui";

import { useLessonNotes } from "../../hooks/use-lesson-notes";

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parses "mm:ss" or a bare integer of seconds. Returns null if invalid/empty. */
function parseTimestampInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const match = /^(\d+):([0-5]?\d)$/.exec(trimmed);
  const minutes = match?.[1];
  const seconds = match?.[2];
  if (!minutes || !seconds) return null;
  return parseInt(minutes, 10) * 60 + parseInt(seconds, 10);
}

const NoteFormSchema = z.object({
  body: z.string().min(1, "Note can't be empty").max(4000),
  atCurrentPosition: z.boolean(),
  manualTimestamp: z.string().optional(),
});
type NoteFormValues = z.infer<typeof NoteFormSchema>;

export interface LessonNotesPanelProps {
  lessonId: string;
  /** Last-synced playback position (seconds), used for "At current position". */
  lastPositionS: number | null;
  /**
   * Overrides the default top margin. Inside the course context panel the
   * component is a tab body rather than a page section, so it needs no margin.
   */
  className?: string;
  /**
   * Hides the "My notes" heading when the surrounding chrome already names the
   * section (e.g. a tab labelled "Notes"), to avoid announcing it twice. The
   * section keeps an accessible name either way.
   */
  hideHeading?: boolean;
}

export function LessonNotesPanel({
  lessonId,
  lastPositionS,
  className,
  hideHeading = false,
}: LessonNotesPanelProps): React.JSX.Element {
  const { notes, isLoading, isSignedOut, isError, create, isCreating, remove, isRemoving } =
    useLessonNotes(lessonId);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NoteFormValues>({
    resolver: zodResolver(NoteFormSchema),
    defaultValues: { body: "", atCurrentPosition: true, manualTimestamp: "" },
  });

  const atCurrentPosition = watch("atCurrentPosition");

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    let timestampS: number | undefined;
    if (values.atCurrentPosition) {
      timestampS = lastPositionS != null && lastPositionS > 0 ? lastPositionS : undefined;
    } else if (values.manualTimestamp) {
      const parsed = parseTimestampInput(values.manualTimestamp);
      if (parsed === null) {
        setFormError("Enter a timestamp as mm:ss (e.g. 4:30).");
        return;
      }
      timestampS = parsed;
    }
    try {
      await create({ body: values.body, timestampS });
      reset({ body: "", atCurrentPosition: true, manualTimestamp: "" });
    } catch {
      setFormError("Couldn't save your note. Please try again.");
    }
  });

  if (isSignedOut) return <></>;

  return (
    <section
      aria-labelledby={hideHeading ? undefined : "lesson-notes-heading"}
      aria-label={hideHeading ? "My notes" : undefined}
      className={className ?? "mt-6"}
      data-testid="lesson-notes-panel"
    >
      {hideHeading ? null : (
        <h2
          id="lesson-notes-heading"
          className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          <NotebookPen aria-hidden="true" className="size-4" />
          My notes
        </h2>
      )}

      {isLoading ? (
        <Skeleton shape="block" className="h-20 w-full rounded-md" />
      ) : isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn&apos;t load your notes.
        </p>
      ) : notes.length === 0 ? (
        <EmptyState
          data-testid="lesson-notes-empty"
          title="No notes yet"
          description="Jot down a thought while you watch. It'll be saved here at the timestamp."
        />
      ) : (
        <ul className="mb-4 flex flex-col gap-2" aria-label="Your notes on this lesson" data-testid="lesson-notes-list">
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3"
              data-testid="lesson-note-item"
            >
              <div className="min-w-0 flex-1">
                {note.timestampS != null ? (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted">
                    <Clock aria-hidden="true" className="size-3" />
                    {formatTimestamp(note.timestampS)}
                  </span>
                ) : null}
                <p className="whitespace-pre-wrap text-sm text-fg">{note.body}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void remove(note.id)}
                disabled={isRemoving}
                aria-label="Delete note"
                data-testid={`lesson-note-delete-${note.id}`}
              >
                <Trash2 aria-hidden="true" className="size-4 text-fg-subtle" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-2" data-testid="lesson-note-form">
        <label htmlFor="lesson-note-body" className="sr-only">
          Add a note
        </label>
        <textarea
          id="lesson-note-body"
          rows={2}
          placeholder="Add a note…"
          {...register("body")}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? "lesson-note-body-error" : undefined}
          className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="lesson-note-body-input"
        />
        {errors.body ? (
          <p id="lesson-note-body-error" role="alert" className="text-sm text-danger">
            {errors.body.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
            <Controller
              control={control}
              name="atCurrentPosition"
              render={({ field }) => (
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  data-testid="lesson-note-at-position"
                />
              )}
            />
            At current position{lastPositionS ? ` (${formatTimestamp(lastPositionS)})` : ""}
          </label>
          {!atCurrentPosition ? (
            <input
              type="text"
              placeholder="mm:ss"
              {...register("manualTimestamp")}
              aria-label="Timestamp (mm:ss)"
              className="h-8 w-20 rounded-md border border-border bg-bg px-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="lesson-note-manual-timestamp"
            />
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={isCreating || isSubmitting}
            aria-busy={isCreating || isSubmitting || undefined}
            data-testid="lesson-note-submit"
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            {isCreating ? "Saving…" : "Save note"}
          </Button>
        </div>

        {formError ? (
          <p role="alert" className="text-sm text-danger" data-testid="lesson-note-error">
            {formError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
