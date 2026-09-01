// Lesson content drawer — the lesson's written summary, and the files attached to it.
//
// The summary lives here as well as in the lesson editor (the pencil), because this is the
// panel staff are already in when they finish attaching a video or a deck and want to say
// what it covers. Both editors read and write the same `lessons.content` through the same
// hooks, so whichever is opened second shows what the other saved — there is one field, two
// doors to it, not two fields.
//
// This is the PDF counterpart to the video ingest flow, with one structural
// difference: a lesson has MANY resources (1:N), whereas video is 1:1 (uploading
// a second video REPLACES the first). So this lists existing attachments and adds
// to them rather than swapping.
//
// INGEST (identical two-step shape to video/course-image, so there is one upload
// pattern to learn):
//   1. resourceUploadUrl() → short-TTL signed PUT + opaque storageKey
//   2. browser PUTs the file DIRECTLY to storage (never proxied through the API)
//   3. createLessonResource({ storageKey, … }) registers the row
// The server rejects a storageKey that isn't in this lesson's own namespace, so a
// tampered client can't attach someone else's object.
//
// CLAUDE.md §3: no business logic here — the hooks own the calls.
import * as React from "react";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  EmptyState,
  FileUpload,
  Input,
  Select,
  SelectItem,
  Skeleton,
  Textarea,
  useToast,
  type SignedUploadResult,
} from "@repo/ui";
import type { LessonResource, LessonResourceType } from "@repo/types";

import {
  useCreateLessonResource,
  useDeleteLessonResource,
  useLessonResources,
  useResourceUploadUrl,
} from "../../hooks/use-lesson-resources";
import { useLesson, useUpdateLesson } from "../../hooks/use-courses";
import { surfaceError } from "../../lib/surface-error";

const RESOURCE_TYPES: { value: LessonResourceType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "slide", label: "Slides" },
  { value: "dataset", label: "Dataset" },
  { value: "cheatsheet", label: "Cheat sheet" },
  { value: "other", label: "Other" },
];

/** Content types the API accepts (mirrors LessonResourceContentTypeSchema). */
const ACCEPTED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "text/csv",
  "image/png",
  "image/jpeg",
] as const;

type AcceptedContentType = (typeof ACCEPTED)[number];

/**
 * Narrows the browser-reported MIME type to the server's allowlist. Some browsers
 * report an empty or odd type for less common files; failing here with a clear
 * message beats sending a request the API will reject with a validation error.
 */
function assertAcceptedType(mime: string): AcceptedContentType {
  const match = ACCEPTED.find((t) => t === mime);
  if (!match) {
    throw new Error("Unsupported file type. Use PDF, PPT/PPTX, ZIP, CSV, PNG or JPG.");
  }
  return match;
}

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB — matches the server ceiling.

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface LessonResourcesDrawerProps {
  programId: string;
  /** The lesson's module — the lesson PATCH route is nested under it. */
  moduleId: string | null;
  lessonId: string | null;
  lessonTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

export function LessonResourcesDrawer({
  programId,
  moduleId,
  lessonId,
  lessonTitle,
  open,
  onOpenChange,
  canEdit,
}: LessonResourcesDrawerProps): React.JSX.Element {
  const { toast } = useToast();
  const { data: resources, isLoading } = useLessonResources(open ? lessonId : undefined);
  const uploadUrl = useResourceUploadUrl();
  const createResource = useCreateLessonResource();
  const deleteResource = useDeleteLessonResource();

  // The lesson's own row, for the summary. Fetched per-lesson because the curriculum tree
  // omits `content` on purpose (a body can be 20k characters and the tree refetches on reorder).
  const { data: lessonDetail } = useLesson(programId, open ? moduleId : null, open ? lessonId : null);
  const updateLesson = useUpdateLesson(programId);

  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<LessonResourceType>("pdf");
  const [summary, setSummary] = React.useState("");
  const [pendingDelete, setPendingDelete] = React.useState<LessonResource | null>(null);

  React.useEffect(() => {
    if (!open) {
      setTitle("");
      setType("pdf");
    }
  }, [open]);

  // Seed the summary from the fetched lesson, and again when a different lesson is opened.
  React.useEffect(() => {
    if (!lessonDetail) return;
    setSummary(lessonDetail.content ?? "");
  }, [lessonDetail]);

  /** Saves the summary alone — title and type are the pencil's business, so they are sent back
   *  unchanged rather than omitted, which a partial PATCH would treat as "leave alone" anyway. */
  async function handleSaveSummary(): Promise<void> {
    if (!lessonId || !moduleId) return;
    try {
      await updateLesson.mutateAsync({ moduleId, lessonId, body: { content: summary } });
      toast({ title: "Summary saved", description: "Students see it on the lesson page.", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't save the summary.");
    }
  }

  /** Step 1+2: mint the signed PUT for the picked file. */
  async function requestUploadUrl(file: File): Promise<SignedUploadResult> {
    if (!lessonId) throw new Error("No lesson selected.");
    const signed = await uploadUrl.mutateAsync({
      lessonId,
      body: {
        // Narrowed client-side for a clear message; the server re-validates
        // against the same allowlist and is the real gate.
        contentType: assertAcceptedType(file.type),
        fileName: file.name,
        sizeBytes: file.size,
      },
    });
    // additionalHeaders are signed into the presigned PUT — forward them or S3/R2 403s.
    return { url: signed.uploadUrl, storageKey: signed.storageKey, headers: signed.additionalHeaders };
  }

  /** Step 3: register the uploaded object against the lesson. */
  async function handleUploaded(storageKey: string, file: File): Promise<void> {
    if (!lessonId) return;
    try {
      await createResource.mutateAsync({
        lessonId,
        body: {
          // Default the display title to the filename when staff didn't type one.
          title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
          type,
          storageKey,
          sizeBytes: file.size,
        },
      });
      toast({ title: "Resource attached", description: "Students can download it from this lesson.", variant: "success" });
      setTitle("");
    } catch (error) {
      surfaceError(toast, error, "The file uploaded but couldn't be attached to the lesson.");
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    try {
      await deleteResource.mutateAsync({ resourceId: pendingDelete.id, lessonId: pendingDelete.lessonId });
      toast({ title: "Resource removed", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't remove this resource.");
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title="Lesson content"
        description={`The summary students read for "${lessonTitle}", and the files they download from it.`}
        size="md"
        data-testid="lesson-resources-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          {/* Summary & notes — the lesson's own body (lessons.content), shown to students on
              the lesson page: under the player on a video lesson, as the body on a reading one. */}
          {canEdit && lessonId ? (
            <div className="flex flex-col gap-3">
              <Textarea
                label="Summary & notes"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={6}
                placeholder="What this lesson covers, key points, and anything to read or do afterwards. HTML is allowed."
                helperText="Shown to enrolled students on the lesson page. Plain text or HTML."
                data-testid="lesson-summary-input"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleSaveSummary()}
                  loading={updateLesson.isPending}
                  disabled={summary === (lessonDetail?.content ?? "")}
                  data-testid="lesson-summary-save"
                >
                  Save summary
                </Button>
              </div>
            </div>
          ) : null}

          {/* Existing attachments */}
          <p
            className={`inline-flex items-center gap-1.5 text-sm font-medium text-fg${canEdit && lessonId ? " border-t border-border pt-4" : ""}`}
          >
            <Paperclip aria-hidden="true" className="size-4" />
            Attached files
          </p>
          <div className="flex flex-col gap-2">
            {isLoading ? (
              <Skeleton shape="block" className="h-16 w-full rounded-md" />
            ) : (resources ?? []).length === 0 ? (
              <EmptyState
                title="No resources yet"
                description="Attach a PDF, slide deck or dataset for students to download alongside this lesson."
                data-testid="lesson-resources-empty"
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {(resources ?? []).map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                    data-testid="lesson-resource-row"
                  >
                    <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{r.title}</span>
                      <span className="text-xs text-fg-muted">
                        {r.type.toUpperCase()}
                        {r.sizeBytes ? ` · ${formatBytes(r.sizeBytes)}` : ""}
                      </span>
                    </span>
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${r.title}`}
                        onClick={() => setPendingDelete(r)}
                        data-testid="lesson-resource-delete"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add new */}
          {canEdit && lessonId ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                <Upload aria-hidden="true" className="size-4" />
                Attach a file
              </p>
              <Input
                label="Title"
                placeholder="Shown to students (defaults to the file name)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="lesson-resource-title"
              />
              <Select
                label="Type"
                required
                value={type}
                onValueChange={(v) => setType(v as LessonResourceType)}
                data-testid="lesson-resource-type"
              >
                {RESOURCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </Select>
              <FileUpload
                requestUploadUrl={requestUploadUrl}
                onUploaded={(storageKey, file) => void handleUploaded(storageKey, file)}
                acceptedTypes={[...ACCEPTED]}
                maxBytes={MAX_BYTES}
                label="Upload resource file"
                data-testid="lesson-resource-upload"
              />
            </div>
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="lesson-resources-close">
            Done
          </Button>
        </DrawerFooter>
      </DrawerContent>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Remove this resource?"
        description={`"${pendingDelete?.title ?? ""}" will no longer be downloadable by students.`}
        confirmLabel="Remove"
        onConfirm={() => void confirmDelete()}
        data-testid="lesson-resource-delete-confirm"
      />
    </Drawer>
  );
}
