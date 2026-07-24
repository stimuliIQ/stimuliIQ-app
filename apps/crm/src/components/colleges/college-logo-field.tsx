// College logo upload widget (Phase-11 locked templates, docs/plans/
// phase-11-locked-templates.md P4). Mirrors page-builder's `ImageKeyField` device-upload
// flow (apps/crm/src/components/page-builder/block-forms/image-key-field.tsx) — raster
// only (jpeg/png/webp, 5 MB cap), signed PUT straight to storage, never proxied through the
// API — but targets `apiClient.crm.colleges.logoUploadUrl` instead of the page-builder's
// media-upload endpoint, and previews via the resolved `logoUrl` the College read model
// already returns (edit mode) or a local object URL for a just-picked file (create mode /
// replacing). `logoKey` stays `undefined` until the author actually uploads a new file —
// leaving it untouched on an edit means "keep the existing logo" (CreateCollegeRequest/
// UpdateCollegeRequest's `logoKey` is optional for exactly this reason).
import * as React from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { Button, useToast } from "@repo/ui";

import { apiClient } from "../../lib/api-client";
import { resolveBlockImageUrl } from "../../lib/page-builder-image";
import { surfaceError } from "../../lib/surface-error";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AcceptedType = (typeof ACCEPTED_TYPES)[number];
/** Matches `CollegeLogoUploadUrlRequestSchema` (5 MB, jpeg/png/webp — no svg). */
const MAX_BYTES = 5 * 1024 * 1024;

function isAcceptedType(type: string): type is AcceptedType {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

export interface CollegeLogoFieldProps {
  /** The newly-uploaded storage key, or `undefined` while unchanged. */
  logoKey: string | undefined;
  onChange: (key: string) => void;
  /** Existing resolved logo URL (edit mode) — shown until a new file is uploaded. */
  existingLogoUrl?: string | null;
}

export function CollegeLogoField({ logoKey, onChange, existingLogoUrl }: CollegeLogoFieldProps): React.JSX.Element {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [localPreview, setLocalPreview] = React.useState<string | null>(null);
  const [broken, setBroken] = React.useState(false);

  const preview = localPreview ?? (logoKey ? resolveBlockImageUrl(logoKey) : (existingLogoUrl ?? null));

  async function upload(file: File, contentType: AcceptedType): Promise<void> {
    setUploading(true);
    try {
      const signed = await apiClient.crm.colleges.logoUploadUrl({ fileName: file.name, contentType, sizeBytes: file.size });
      const res = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, ...(signed.additionalHeaders ?? {}) },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setBroken(false);
      setLocalPreview(URL.createObjectURL(file));
      onChange(signed.storageKey);
      toast({ title: "Logo uploaded", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't upload the logo — check your connection and try again.");
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
      toast({ title: "Image too large", description: "Maximum logo size is 5 MB.", variant: "destructive" });
      return;
    }
    void upload(file, file.type);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-fg">Logo</span>
      <div className="flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface">
          {preview && !broken ? (
            <img src={preview} alt="" className="size-full object-contain" onError={() => setBroken(true)} data-testid="college-logo-preview" />
          ) : (
            <span className="px-1 text-center text-[10px] text-fg-subtle">No logo</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="sr-only"
          data-testid="college-logo-upload-input"
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
          data-testid="college-logo-upload-button"
        >
          <Upload className="size-4" aria-hidden="true" />
          {uploading ? "Uploading…" : logoKey || preview ? "Replace logo" : "Upload logo"}
        </Button>
      </div>
      {broken ? (
        <p className="flex items-center gap-1.5 text-xs text-warning" data-testid="college-logo-preview-error">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          Image not found.
        </p>
      ) : null}
      <p className="text-xs text-fg-subtle">JPG, PNG, or WebP · up to 5 MB.</p>
    </div>
  );
}
