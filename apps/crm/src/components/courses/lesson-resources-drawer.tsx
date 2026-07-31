// Lesson resources drawer — attach PDFs / slides / datasets to a lesson.
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
import { FileText, Trash2, Upload } from "lucide-react";
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
  lessonId: string | null;
  lessonTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}

export function LessonResourcesDrawer({
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

  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<LessonResourceType>("pdf");
  const [pendingDelete, setPendingDelete] = React.useState<LessonResource | null>(null);

  React.useEffect(() => {
    if (!open) {
      setTitle("");
      setType("pdf");
    }
  }, [open]);

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
        title="Lesson resources"
        description={`PDFs, slides and datasets attached to "${lessonTitle}". Students download these from the lesson page.`}
        size="md"
        data-testid="lesson-resources-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          {/* Existing attachments */}
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
