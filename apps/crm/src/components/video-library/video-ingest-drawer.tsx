// Video library ingest drawer — program → lesson picker, then a FileUpload wired
// to the video-library "ingest == attach" endpoint (see @repo/types
// lms/video-library.schemas.ts file header): `videoLibrary.create({ lessonId })`
// returns both the video row AND the one-time signed upload URL in the SAME call,
// so `requestUploadUrl` below calls `create()` exactly once (memoized) rather than
// per-file. Phase 9 Completion T26/T38.
//
// REPLACE MODE (`replaceFor`): opened from the video library's Replace action with
// the lesson pre-selected and locked, so swapping a file is two clicks (Replace →
// pick file) instead of re-navigating the program/lesson pickers. Ingesting for a
// lesson that already has a video replaces it in place — same endpoint, no delete.
//
// ATTACH MODE (`attachFor`): opened from the curriculum builder's per-lesson video
// button, with the lesson locked but no existing video row. Same locked-lesson UX
// as replace, just seeded from a lessonId instead of a VideoAsset — this is what
// lets an author attach a video to a lesson without leaving the curriculum. Both
// "locked" modes share one code path; only the wording differs.
//
// UPLOAD CONFIRMATION: after the browser's direct PUT succeeds we call
// `markUploaded`, which flips non-transcoding providers (local dev) to `ready`.
// Without it the asset sits on `processing` forever and every stream-url 503s.
// We also read the file's duration from a throwaway <video> element so the library
// and LMS show a real length instead of "—".
import * as React from "react";
import { Alert, Button, Drawer, DrawerContent, DrawerBody, DrawerFooter, FileUpload, Select, SelectItem, useToast } from "@repo/ui";
import type { VideoAsset } from "@repo/types";

import { useIngestVideoAsset, useMarkVideoUploaded } from "../../hooks/use-video-library";
import { useProgramsList, useCurriculum } from "../../hooks/use-courses";

interface VideoIngestDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the drawer replaces THIS lesson's video (pickers hidden). */
  replaceFor?: VideoAsset | null;
  /**
   * When set (and no `replaceFor`), the drawer attaches a video to THIS lesson
   * with the pickers hidden — used from the curriculum so an author never has to
   * re-pick the program/lesson they're already looking at.
   */
  attachFor?: { lessonId: string; lessonTitle: string } | null;
}

/**
 * Reads duration from the picked file locally (no upload round-trip). Best-effort:
 * resolves undefined for containers the browser can't decode, which just means the
 * library shows "—" until a transcode webhook supplies one.
 */
function readVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.onloadedmetadata = () =>
      done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

export function VideoIngestDrawer({ open, onOpenChange, replaceFor, attachFor }: VideoIngestDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const isReplace = Boolean(replaceFor);
  // Either "locked" mode targets a known lesson and hides the pickers. Replace
  // wins if both are somehow passed (it carries the richer VideoAsset).
  const lockedLesson = replaceFor
    ? { lessonId: replaceFor.lessonId, lessonTitle: replaceFor.lessonTitle }
    : (attachFor ?? null);
  const isLocked = Boolean(lockedLesson);
  const [programId, setProgramId] = React.useState<string | undefined>(undefined);
  const [lessonId, setLessonId] = React.useState<string | undefined>(undefined);
  const [uploaded, setUploaded] = React.useState(false);

  const { data: programs } = useProgramsList({ page: 1, pageSize: 200, includeDeleted: false });
  const { data: curriculum } = useCurriculum(programId);
  const ingestVideo = useIngestVideoAsset();
  const markUploaded = useMarkVideoUploaded();

  /**
   * EVERY lesson in the course, not just the ones already typed `video`.
   *
   * The old filter was `type === "video"`, which meant a course whose lessons were created
   * as readings showed an empty dropdown with no explanation — the reported "lessons are not
   * loading". Nothing on the server ever required it: `findLessonForIngest` accepts any
   * lesson. Attaching to a non-video lesson now promotes it (see the note below the picker
   * and VideoLibraryService#createIngest), because a lesson whose content is a video IS a
   * video lesson — and the LMS only renders the player for `type === "video"`, so leaving it
   * alone would have uploaded a file no student could see.
   */
  const lessons = (curriculum?.modules ?? []).flatMap((mod) =>
    mod.lessons.map((l) => ({ ...l, moduleTitle: mod.title })),
  );
  const selectedLesson = lessons.find((l) => l.id === lessonId);
  const curriculumLoaded = Boolean(curriculum);

  // Memoized: create() must run exactly once per lesson selection, not once per file.
  const pendingRequestRef = React.useRef<Promise<{ url: string; storageKey: string }> | null>(null);

  React.useEffect(() => {
    if (!open) {
      setProgramId(undefined);
      setLessonId(undefined);
      setUploaded(false);
      pendingRequestRef.current = null;
      return;
    }
    // Locked mode (replace or attach): target the known lesson directly.
    // `lockedLesson` is derived from `replaceFor`/`attachFor`, which are the deps.
    if (lockedLesson) {
      setLessonId(lockedLesson.lessonId);
      pendingRequestRef.current = null;
    }
  }, [open, replaceFor, attachFor]);

  const effectiveLessonId = isLocked ? lockedLesson?.lessonId : lessonId;

  async function requestUploadUrl(): Promise<{ url: string; storageKey: string }> {
    if (!effectiveLessonId) throw new Error("Select a lesson first.");
    if (!pendingRequestRef.current) {
      pendingRequestRef.current = ingestVideo
        .mutateAsync({ lessonId: effectiveLessonId })
        // storageKey carries the VIDEO ROW id so onUploaded can confirm against it.
        .then((res) => ({ url: res.uploadUrl, storageKey: res.video.id }));
    }
    return pendingRequestRef.current;
  }

  // FileUpload hands back the video ROW id we returned as `storageKey`, plus the File.
  async function handleUploaded(videoId: string, file: File): Promise<void> {
    setUploaded(true);
    const durationS = await readVideoDuration(file);
    try {
      await markUploaded.mutateAsync({ id: videoId, durationS });
      toast({
        title: isReplace ? "Video replaced" : "Video uploaded",
        description: "It's now attached to the lesson and available to enrolled students.",
        variant: "success",
      });
    } catch {
      // The file IS stored; only the status confirmation failed. Say so honestly
      // rather than claiming success or implying the upload was lost.
      toast({
        title: "Uploaded, but not yet marked ready",
        description: "The file was stored. Refresh the library — if it still shows 'processing', try uploading again.",
        variant: "destructive",
      });
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={isReplace ? "Replace video" : isLocked ? "Add video" : "Upload video"}
        description={
          isReplace
            ? `Swap the source file for "${lockedLesson?.lessonTitle}". The old file is replaced in place.`
            : isLocked
              ? `Attach a video to "${lockedLesson?.lessonTitle}". Students see it in the LMS as soon as it's ready.`
              : "Attach a source video to a lesson. Students see it in the LMS as soon as it's ready."
        }
        size="md"
        data-testid="video-ingest-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          {isLocked ? (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
              {isReplace ? "Replacing the video for" : "Attaching a video to"}{" "}
              <span className="font-medium text-fg">{lockedLesson?.lessonTitle}</span>
            </p>
          ) : (
            <>
              <Select
                label="Program"
                required
                placeholder="Select a program"
                value={programId}
                onValueChange={(v) => {
                  setProgramId(v);
                  setLessonId(undefined);
                  pendingRequestRef.current = null;
                }}
                data-testid="video-ingest-program-select"
              >
                {(programs?.items ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </Select>

              <Select
                label="Lesson"
                required
                placeholder={
                  !programId
                    ? "Select a course first"
                    : !curriculumLoaded
                      ? "Loading lessons…"
                      : lessons.length === 0
                        ? "This course has no lessons yet"
                        : "Select a lesson"
                }
                value={lessonId}
                onValueChange={(v) => {
                  setLessonId(v);
                  pendingRequestRef.current = null;
                }}
                disabled={!programId || lessons.length === 0}
                helperText={
                  programId && curriculumLoaded && lessons.length === 0
                    ? "Add a lesson to this course under Courses ▸ Curriculum, then upload the video here."
                    : undefined
                }
                data-testid="video-ingest-lesson-select"
              >
                {lessons.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.moduleTitle} — {l.title}
                    {l.type !== "video" ? ` (${l.type})` : ""}
                  </SelectItem>
                ))}
              </Select>

              {/* Say it before the upload, not after: the lesson's type decides whether the
                  LMS renders a player at all, so attaching here changes it. */}
              {selectedLesson && selectedLesson.type !== "video" ? (
                <Alert tone="info" data-testid="video-ingest-type-change-note">
                  “{selectedLesson.title}” is currently a {selectedLesson.type} lesson. Uploading a video turns it into
                  a video lesson so students can watch it.
                </Alert>
              ) : null}
            </>
          )}

          {effectiveLessonId ? (
            <FileUpload
              requestUploadUrl={requestUploadUrl}
              onUploaded={(videoId, file) => void handleUploaded(videoId, file)}
              acceptedTypes={["video/mp4", "video/quicktime", "video/webm"]}
              maxBytes={5 * 1024 * 1024 * 1024}
              label={isReplace ? "Upload replacement file" : "Upload video file"}
              data-testid="video-ingest-upload"
            />
          ) : null}

          {ingestVideo.isError ? (
            <p role="alert" className="text-sm text-danger">
              Couldn&apos;t start the upload — try selecting the lesson again.
            </p>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} data-testid="video-ingest-close">
            {uploaded ? "Done" : "Close"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
