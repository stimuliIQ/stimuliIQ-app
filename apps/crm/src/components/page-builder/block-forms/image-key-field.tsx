// Shared "Image" field — renders a plain-language `Input` (docs/specs/
// phase-10-ui-polish-ux-audit.md PB-4/C2: "Background image key" → "Image" + helper) plus a
// live thumbnail preview resolved via `resolveBlockImageUrl`. On a broken/unresolvable key
// shows a gentle "image not found" warning instead of a broken-image icon — NEVER blocks
// save (this is presentation-only; the underlying field is still a plain string input, the
// zod schema is unchanged).
//
// Device upload (frontend-builder pass, docs/specs/phase-10-page-builder.md): an "Upload
// image" button beside the text input lets an editor pick a file from their device instead
// of typing/pasting a storage key by hand. Flow:
//   1. Client-side validate type (jpeg/png/webp only) + size (5 MB) — mirrors the server's
//      `mediaUploadUrl` policy so obviously-invalid files never consume a signed URL.
//   2. `apiClient.crm.contentPages.mediaUploadUrl({ fileName, contentType, sizeBytes })`
//      mints a short-lived signed PUT URL (packages/types storage.schemas.ts's
//      `SignedUploadResponse` — same contract as the course-image/mentor-photo uploaders).
//   3. PUT the file directly to `uploadUrl` (with `additionalHeaders` if present) — never
//      proxied through the API server.
//   4. On success, `onUploadedKey(storageKey)` fires; the parent sets it into the owning
//      react-hook-form field via `setValue(name, key, { shouldDirty: true, shouldValidate:
//      true })` (kept in the parent because each of the 4 consuming block forms has its own
//      RHF generic — see hero/content-split/feature-grid/media-gallery-fields.tsx).
// Manual key entry keeps working exactly as before — some images are legacy `/images/...`
// static paths that were never uploaded to object storage and can't be "picked" this way.
//
// Deferred (docs/phase-10-followups.md-style note, not filed separately): an inline
// crop/zoom step (see `../../shared/image-crop-upload.tsx`) would be ideal for
// aspect-sensitive spots like hero flanking photos, but that component's full adjuster UI
// doesn't fit this field's compact single-line footprint, and per-field-only cropping would
// make the same block form behave inconsistently across its own image fields. Plain upload
// (original file, uncropped) everywhere is the simpler, consistent default for now.
import * as React from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { AlertTriangle, Upload } from "lucide-react";
import { Button, Input, useToast } from "@repo/ui";

import { resolveBlockImageUrl } from "../../../lib/page-builder-image";
import { apiClient } from "../../../lib/api-client";
import { surfaceError } from "../../../lib/surface-error";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AcceptedType = (typeof ACCEPTED_TYPES)[number];
/** Matches the `mediaUploadUrl` server policy (5 MB, jpeg/png/webp — no svg). */
const MAX_BYTES = 5 * 1024 * 1024;

export interface ImageKeyFieldProps {
  label?: string;
  helperText?: string;
  required?: boolean;
  error?: string;
  /** Spread of react-hook-form's `register(name)` return. */
  registered: UseFormRegisterReturn;
  /** The field's current live value (from the owning form's `watch()`) — drives the preview. */
  watchedValue: string | undefined;
  /** Test hook for the underlying `Input`. */
  testId: string;
  /**
   * Called with the new storage key after a successful device upload. The parent MUST wire
   * this to react-hook-form's `setValue(name, key, { shouldDirty: true, shouldValidate:
   * true })` for the owning field — this component never touches form state directly.
   */
  onUploadedKey: (key: string) => void;
}

function isAcceptedType(type: string): type is AcceptedType {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

export function ImageKeyField({
  label = "Image",
  helperText = "The image's file name in your media library.",
  required,
  error,
  registered,
  watchedValue,
  testId,
  onUploadedKey,
}: ImageKeyFieldProps): React.JSX.Element {
  const { toast } = useToast();
  const url = resolveBlockImageUrl(watchedValue);
  const [broken, setBroken] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Re-attempt the preview whenever the resolved URL changes (a fixed typo should clear a
  // stale "not found" warning without needing a full remount).
  React.useEffect(() => {
    setBroken(false);
  }, [url]);

  // `contentType` is threaded through separately (rather than re-read as `file.type` inside
  // `upload`) so the `isAcceptedType` narrowing at the `handleFile` call site actually reaches
  // the strict `"image/jpeg" | "image/png" | "image/webp"` union `mediaUploadUrl` expects —
  // TS narrowing on `file.type` doesn't survive re-reading the property inside a different
  // function scope, only the narrowed expression itself.
  async function upload(file: File, contentType: AcceptedType): Promise<void> {
    setUploading(true);
    try {
      const signed = await apiClient.crm.contentPages.mediaUploadUrl({
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
      });
      const res = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, ...(signed.additionalHeaders ?? {}) },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      onUploadedKey(signed.storageKey);
      toast({ title: "Image uploaded", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't upload the image. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleFile(file: File | undefined): void {
    if (!file) return;
    if (!isAcceptedType(file.type)) {
      toast({ title: "Unsupported image", description: "Use a JPG, PNG, or WebP file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Image too large", description: "Maximum image size is 5 MB.", variant: "destructive" });
      return;
    }
    void upload(file, file.type);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex items-end gap-2 rounded-md"
        onDragOver={(e) => {
          if (uploading) return;
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (uploading) return;
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        <Input
          label={label}
          helperText={helperText}
          required={required}
          error={error}
          data-testid={testId}
          wrapperClassName={isDragOver ? "flex-1 rounded-md ring-2 ring-brand-500" : "flex-1"}
          {...registered}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          data-testid={`${testId}-upload-input`}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
          aria-label={`Upload ${label.toLowerCase()} from your device`}
          className="mb-[1px] shrink-0"
          data-testid={`${testId}-upload-button`}
        >
          <Upload aria-hidden="true" className="size-4" />
          {uploading ? "Uploading…" : "Upload image"}
        </Button>
      </div>
      {url ? (
        broken ? (
          <p className="flex items-center gap-1.5 text-xs text-warning" data-testid={`${testId}-preview-error`}>
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            Image not found, check the file name.
          </p>
        ) : (
          <img
            src={url}
            alt=""
            className="size-14 rounded-md border border-border object-cover"
            onError={() => setBroken(true)}
            data-testid={`${testId}-preview`}
          />
        )
      ) : null}
    </div>
  );
}
