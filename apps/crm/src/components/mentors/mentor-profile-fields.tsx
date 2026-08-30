// Shared marketing-profile fields for the mentor create/edit drawer: photo upload
// (with an inline crop/zoom adjuster), professional title/headline, bio, years of
// experience, and social links. Rendered in BOTH the create and edit branches of
// mentor-form-drawer.tsx so the two stay in sync. Typed loosely
// (UseFormRegister<any> etc.) because the two branches use different RHF generics
// (CreateMentorFormValues vs UpdateMentorFormValues) but the field paths
// (photoKey/title/bio/yearsExperience/socialLinks.*) are identical.
//
// Photo upload flow (staff-scoped, matches faculty-bio photoKey precedent):
//   1. User picks a file → inline adjuster (drag to pan, slider to zoom inside a
//      square viewport) — no nested dialog, the panel renders in the drawer body.
//   2. "Apply photo" renders the visible square to a 512×512 canvas (JPEG).
//   3. POST /crm/mentors/photo-upload-url → signed PUT URL + storageKey.
//   4. PUT the cropped blob directly to the signed URL (never through the API).
//   5. Store `storageKey` in the form's `photoKey` field; the API mints the public
//      CDN photoUrl from it on save.
// The original file is kept in memory so "Adjust" can re-open the crop after an
// upload (re-applying uploads a fresh key). Pre-existing remote photos can't be
// re-cropped client-side (CORS-tainted canvas) — upload a new file instead.
import * as React from "react";
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { Upload, X, User as UserIcon, Crop as CropIcon } from "lucide-react";
import { Button, Input, Textarea, useToast } from "@repo/ui";

import { apiClient } from "../../lib/api-client";
import { surfaceError } from "../../lib/surface-error";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"] as const;
type AcceptedType = (typeof ACCEPTED)[number];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (matches MentorPhotoUploadUrlRequestSchema)

/** Square crop viewport edge (display px) and canvas output edge (upload px). */
const VIEWPORT = 256;
const OUTPUT = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

// Social links are OPTIONAL URLs. An empty text input yields "" which fails the
// schema's `.url()` at the zodResolver (blocking submit before onSubmit's
// normalize runs), so we coerce blank → undefined at the field level: the
// resolver's `.optional()` then accepts it. Trimmed so stray whitespace also
// counts as blank. (register.setValueAs; mirrors the onSubmit normalize.)
const blankUrlToUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

interface AdjustState {
  file: File;
  /** Object URL for the original file (revoked when the adjuster closes). */
  url: string;
  /** Natural image dimensions, set once the <img> loads. */
  naturalWidth: number;
  naturalHeight: number;
}

/** Cover-fit base scale: the smallest scale at which the image fills the viewport. */
function coverScale(nw: number, nh: number): number {
  return Math.max(VIEWPORT / nw, VIEWPORT / nh);
}

/** Clamp the image's top-left offset so the viewport is always fully covered. */
function clampOffset(value: number, scaledEdge: number): number {
  return Math.min(0, Math.max(VIEWPORT - scaledEdge, value));
}

interface MentorProfileFieldsProps {
  // RHF methods are typed `any` here to bridge the two callers' different form generics
  // (CreateMentorFormValues vs UpdateMentorFormValues) — both expose identical field
  // paths (photoKey/title/bio/yearsExperience/socialLinks.*), so the parent forms keep
  // full type safety; only this shared bridge is loose (justification per CLAUDE.md §3.1).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  watch: UseFormWatch<any>;
  /** Existing photo URL (edit mode) to seed the preview. */
  initialPhotoUrl?: string | null;
}

export function MentorProfileFields({
  register,
  setValue,
  watch,
  initialPhotoUrl,
}: MentorProfileFieldsProps): React.JSX.Element {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const dragRef = React.useRef<{ pointerId: number; startX: number; startY: number; startOx: number; startOy: number } | null>(null);

  const [preview, setPreview] = React.useState<string | null>(initialPhotoUrl ?? null);
  const [uploading, setUploading] = React.useState(false);
  /** Original file of the last session-selected photo, kept for re-adjusting. */
  const [original, setOriginal] = React.useState<File | null>(null);
  const [adjust, setAdjust] = React.useState<AdjustState | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  const photoKey = watch("photoKey") as string | null | undefined;

  // Revoke the adjuster's object URL when it's replaced or unmounted.
  React.useEffect(() => {
    const url = adjust?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [adjust?.url]);

  function beginAdjust(file: File): void {
    if (!ACCEPTED.includes(file.type as AcceptedType)) {
      toast({ title: "Unsupported image", description: "Use a JPG, PNG, or WebP file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Image too large", description: "Maximum photo size is 5 MB.", variant: "destructive" });
      return;
    }
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setAdjust({ file, url: URL.createObjectURL(file), naturalWidth: 0, naturalHeight: 0 });
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>): void {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setAdjust((prev) => (prev ? { ...prev, naturalWidth, naturalHeight } : prev));
    // Centre the image at cover scale.
    const s = coverScale(naturalWidth, naturalHeight);
    setOffset({ x: (VIEWPORT - naturalWidth * s) / 2, y: (VIEWPORT - naturalHeight * s) / 2 });
  }

  /** Current total scale (cover × zoom); 0 until the image has loaded. */
  const scale = adjust && adjust.naturalWidth > 0 ? coverScale(adjust.naturalWidth, adjust.naturalHeight) * zoom : 0;

  function handleZoom(nextZoom: number): void {
    if (!adjust || adjust.naturalWidth === 0) return;
    const s1 = coverScale(adjust.naturalWidth, adjust.naturalHeight) * zoom;
    const s2 = coverScale(adjust.naturalWidth, adjust.naturalHeight) * nextZoom;
    // Anchor the viewport centre: keep the same image point under it.
    const cx = (VIEWPORT / 2 - offset.x) / s1;
    const cy = (VIEWPORT / 2 - offset.y) / s1;
    setZoom(nextZoom);
    setOffset({
      x: clampOffset(VIEWPORT / 2 - cx * s2, adjust.naturalWidth * s2),
      y: clampOffset(VIEWPORT / 2 - cy * s2, adjust.naturalHeight * s2),
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!adjust) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startOx: offset.x, startOy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || !adjust || drag.pointerId !== e.pointerId || scale === 0) return;
    setOffset({
      x: clampOffset(drag.startOx + (e.clientX - drag.startX), adjust.naturalWidth * scale),
      y: clampOffset(drag.startOy + (e.clientY - drag.startY), adjust.naturalHeight * scale),
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  async function applyAdjust(): Promise<void> {
    const img = imgRef.current;
    if (!adjust || !img || scale === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // JPEG has no alpha — flatten transparent PNG/WebP onto white.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.drawImage(
      img,
      -offset.x / scale,
      -offset.y / scale,
      VIEWPORT / scale,
      VIEWPORT / scale,
      0,
      0,
      OUTPUT,
      OUTPUT,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      toast({
        title: "Couldn't process the image",
        description: "The browser could not read this file as an image. Try a different file, or a JPEG or PNG.",
        variant: "destructive",
      });
      return;
    }
    const baseName = adjust.file.name.replace(/\.[^.]+$/, "") || "mentor-photo";
    const cropped = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    const source = adjust.file;
    setAdjust(null);
    await uploadPhoto(cropped, source);
  }

  async function uploadPhoto(file: File, source: File): Promise<void> {
    setUploading(true);
    try {
      const signed = await apiClient.crm.mentors.photoUploadUrl({
        contentType: file.type as AcceptedType,
        fileName: file.name,
        sizeBytes: file.size,
      });
      const res = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, ...(signed.additionalHeaders ?? {}) },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setValue("photoKey", signed.storageKey, { shouldDirty: true });
      setPreview(URL.createObjectURL(file));
      setOriginal(source);
      toast({ title: "Photo uploaded", variant: "success" });
    } catch (error) {
      surfaceError(
        toast,
        error,
        "Couldn't upload the photo. Object storage may not be configured in this environment.",
      );
    } finally {
      setUploading(false);
    }
  }

  function clearPhoto(): void {
    setValue("photoKey", null, { shouldDirty: true });
    setPreview(null);
    setOriginal(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <>
      {/* ── Photo ── */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg">Photo</span>

        {adjust ? (
          /* Inline adjuster: drag to reposition, slider to zoom. */
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" data-testid="mentor-form-photo-adjust">
            <div
              role="application"
              aria-label="Adjust photo position. Drag to move the image inside the frame."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative mx-auto touch-none cursor-move select-none overflow-hidden rounded-md border border-border bg-card"
              style={{ width: VIEWPORT, height: VIEWPORT }}
            >
              <img
                ref={imgRef}
                src={adjust.url}
                alt=""
                draggable={false}
                onLoad={onImageLoad}
                className="pointer-events-none absolute max-w-none origin-top-left"
                style={
                  scale > 0
                    ? {
                        width: adjust.naturalWidth * scale,
                        height: adjust.naturalHeight * scale,
                        transform: `translate(${offset.x}px, ${offset.y}px)`,
                      }
                    : undefined
                }
              />
              {/* Circular crop hint overlay (the avatar renders round) */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-border">
                <div className="absolute inset-4 rounded-full border border-dashed border-fg/30" />
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm text-fg-muted">
              Zoom
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => handleZoom(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer accent-brand-500"
                aria-label="Zoom"
                data-testid="mentor-form-photo-zoom"
              />
            </label>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdjust(null)} data-testid="mentor-form-photo-adjust-cancel">
                Cancel
              </Button>
              <Button type="button" size="sm" loading={uploading} onClick={() => void applyAdjust()} data-testid="mentor-form-photo-adjust-apply">
                Apply photo
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface">
              {preview ? (
                <img src={preview} alt="" className="size-full object-cover" />
              ) : (
                <UserIcon aria-hidden="true" className="size-7 text-fg-subtle" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED.join(",")}
                className="sr-only"
                data-testid="mentor-form-photo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) beginAdjust(file);
                  // Allow re-selecting the same file later.
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
                data-testid="mentor-form-photo-upload"
              >
                <Upload aria-hidden="true" className="size-4" />
                {photoKey || preview ? "Replace image" : "Upload image"}
              </Button>
              {original ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => beginAdjust(original)}
                  data-testid="mentor-form-photo-adjust-open"
                >
                  <CropIcon aria-hidden="true" className="size-4" />
                  Adjust
                </Button>
              ) : null}
              {photoKey || preview ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearPhoto}
                  data-testid="mentor-form-photo-remove"
                >
                  <X aria-hidden="true" className="size-4" />
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        )}
        <p className="text-xs text-fg-subtle">
          JPG, PNG, or WebP · up to 5 MB. Drag and zoom to fit the square frame. Shown on the public mentors page.
        </p>
      </div>

      {/* ── Professional details ── */}
      <Input
        label="Title / headline"
        placeholder="Senior ML Engineer, Microsoft"
        {...register("title")}
        data-testid="mentor-form-title"
      />

      <Textarea
        id="mentor-form-bio"
        label="Bio"
        rows={4}
        placeholder="A short professional biography shown on the mentor's public card."
        {...register("bio")}
        data-testid="mentor-form-bio"
      />

      <Input
        label="Years of experience"
        type="number"
        min={0}
        max={70}
        placeholder="e.g. 8"
        {...register("yearsExperience", { valueAsNumber: true })}
        data-testid="mentor-form-years"
      />

      {/* ── Social links ── */}
      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
        <span className="text-sm font-medium text-fg">Social links</span>
        <Input label="LinkedIn" placeholder="https://linkedin.com/in/…" {...register("socialLinks.linkedin", { setValueAs: blankUrlToUndefined })} data-testid="mentor-form-linkedin" />
        <Input label="X / Twitter" placeholder="https://x.com/…" {...register("socialLinks.twitter", { setValueAs: blankUrlToUndefined })} data-testid="mentor-form-twitter" />
        <Input label="GitHub" placeholder="https://github.com/…" {...register("socialLinks.github", { setValueAs: blankUrlToUndefined })} data-testid="mentor-form-github" />
        <Input label="Website" placeholder="https://…" {...register("socialLinks.website", { setValueAs: blankUrlToUndefined })} data-testid="mentor-form-website" />
      </div>
    </>
  );
}

/**
 * Normalises the raw RHF profile values before zod parse:
 *  - blank social-link strings → dropped (empty string fails `.url()`); all-empty → undefined.
 *  - NaN/empty yearsExperience → undefined.
 *  - blank title/bio → undefined.
 * Returns a patch to spread over the form values.
 */
export function normalizeProfileValues(values: Record<string, unknown>): Record<string, unknown> {
  const rawSocial = (values.socialLinks ?? {}) as Record<string, unknown>;
  const social: Record<string, string> = {};
  for (const k of ["linkedin", "twitter", "github", "website"] as const) {
    const v = rawSocial[k];
    if (typeof v === "string" && v.trim()) social[k] = v.trim();
  }
  const years = values.yearsExperience;
  const title = typeof values.title === "string" ? values.title.trim() : values.title;
  const bio = typeof values.bio === "string" ? values.bio.trim() : values.bio;

  return {
    title: title ? title : undefined,
    bio: bio ? bio : undefined,
    yearsExperience: typeof years === "number" && !Number.isNaN(years) ? years : undefined,
    socialLinks: Object.keys(social).length > 0 ? social : undefined,
  };
}
