// ImageCropUpload — reusable image picker with an inline crop/zoom adjuster and
// direct-to-storage upload (signed PUT URL minted by the caller-supplied
// `getUploadUrl`). Generalises the mentor photo adjuster pattern
// (mentors/mentor-profile-fields.tsx) with a configurable aspect ratio so course
// cards (16:9) and avatars (1:1) share one implementation.
//
// Flow:
//   1. User picks a file → inline adjuster (drag to pan, slider to zoom inside a
//      fixed-aspect viewport) — renders in place, no nested dialog.
//   2. "Apply image" renders the visible crop to a canvas (JPEG) and PUTs it
//      directly to the signed URL (never through the API server).
//   3. `onChange(storageKey)` fires; the parent stores the key in its form state.
//      Remove fires `onChange(null)`.
// The original file is kept in memory so "Adjust" can re-crop after an upload.
// Pre-existing remote images can't be re-cropped client-side (CORS-tainted
// canvas) — upload a new file instead.
import * as React from "react";
import { Upload, X, Image as ImageIcon, Crop as CropIcon } from "lucide-react";
import { Button, useToast } from "@repo/ui";
import type { SignedUploadResponse } from "@repo/types";

import { surfaceError } from "../../lib/surface-error";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"] as const;
type AcceptedType = (typeof ACCEPTED)[number];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (matches the upload-url request schemas)

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
/** Crop viewport width (display px); height derives from `aspect`. */
const VIEWPORT_W = 320;
/** Canvas output width (upload px); height derives from `aspect`. */
const OUTPUT_W = 1280;

export interface ImageCropUploadProps {
  label: string;
  helperText?: string;
  /** Existing image URL (edit mode) to seed the preview. */
  initialImageUrl?: string | null;
  /** Viewport aspect ratio (width / height), e.g. 16/9 for course cards, 1 for avatars. */
  aspect: number;
  /** Mint a signed PUT URL for the (cropped) file. */
  getUploadUrl: (req: {
    contentType: AcceptedType;
    fileName: string;
    sizeBytes: number;
  }) => Promise<SignedUploadResponse>;
  /** New storage key after upload; null when the image is removed. */
  onChange: (storageKey: string | null) => void;
  "data-testid"?: string;
}

interface AdjustState {
  file: File;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
}

export function ImageCropUpload({
  label,
  helperText,
  initialImageUrl,
  aspect,
  getUploadUrl,
  onChange,
  "data-testid": testId = "image-crop-upload",
}: ImageCropUploadProps): React.JSX.Element {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOx: number;
    startOy: number;
  } | null>(null);

  const viewportH = Math.round(VIEWPORT_W / aspect);
  const outputH = Math.round(OUTPUT_W / aspect);

  const [preview, setPreview] = React.useState<string | null>(initialImageUrl ?? null);
  const [hasImage, setHasImage] = React.useState<boolean>(Boolean(initialImageUrl));
  const [uploading, setUploading] = React.useState(false);
  const [original, setOriginal] = React.useState<File | null>(null);
  const [adjust, setAdjust] = React.useState<AdjustState | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  React.useEffect(() => {
    const url = adjust?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [adjust?.url]);

  /** Cover-fit base scale: smallest scale at which the image fills the viewport. */
  const coverScale = React.useCallback(
    (nw: number, nh: number) => Math.max(VIEWPORT_W / nw, viewportH / nh),
    [viewportH],
  );

  const clampX = (v: number, scaledW: number) => Math.min(0, Math.max(VIEWPORT_W - scaledW, v));
  const clampY = (v: number, scaledH: number) => Math.min(0, Math.max(viewportH - scaledH, v));

  const scale =
    adjust && adjust.naturalWidth > 0 ? coverScale(adjust.naturalWidth, adjust.naturalHeight) * zoom : 0;

  function beginAdjust(file: File): void {
    if (!ACCEPTED.includes(file.type as AcceptedType)) {
      toast({ title: "Unsupported image", description: "Use a JPG, PNG, or WebP file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Image too large", description: "Maximum image size is 5 MB.", variant: "destructive" });
      return;
    }
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setAdjust({ file, url: URL.createObjectURL(file), naturalWidth: 0, naturalHeight: 0 });
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>): void {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setAdjust((prev) => (prev ? { ...prev, naturalWidth, naturalHeight } : prev));
    const s = coverScale(naturalWidth, naturalHeight);
    setOffset({ x: (VIEWPORT_W - naturalWidth * s) / 2, y: (viewportH - naturalHeight * s) / 2 });
  }

  function handleZoom(nextZoom: number): void {
    if (!adjust || adjust.naturalWidth === 0) return;
    const base = coverScale(adjust.naturalWidth, adjust.naturalHeight);
    const s1 = base * zoom;
    const s2 = base * nextZoom;
    const cx = (VIEWPORT_W / 2 - offset.x) / s1;
    const cy = (viewportH / 2 - offset.y) / s1;
    setZoom(nextZoom);
    setOffset({
      x: clampX(VIEWPORT_W / 2 - cx * s2, adjust.naturalWidth * s2),
      y: clampY(viewportH / 2 - cy * s2, adjust.naturalHeight * s2),
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
      x: clampX(drag.startOx + (e.clientX - drag.startX), adjust.naturalWidth * scale),
      y: clampY(drag.startOy + (e.clientY - drag.startY), adjust.naturalHeight * scale),
    });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  async function applyAdjust(): Promise<void> {
    const img = imgRef.current;
    if (!adjust || !img || scale === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_W;
    canvas.height = outputH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // JPEG has no alpha — flatten transparent PNG/WebP onto white.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUTPUT_W, outputH);
    ctx.drawImage(
      img,
      -offset.x / scale,
      -offset.y / scale,
      VIEWPORT_W / scale,
      viewportH / scale,
      0,
      0,
      OUTPUT_W,
      outputH,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) {
      toast({
        title: "Couldn't process the image",
        description: "The browser could not read this file as an image. Try a different file, or a JPEG or PNG.",
        variant: "destructive",
      });
      return;
    }
    const baseName = adjust.file.name.replace(/\.[^.]+$/, "") || "image";
    const cropped = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    const source = adjust.file;
    setAdjust(null);
    await upload(cropped, source);
  }

  async function upload(file: File, source: File): Promise<void> {
    setUploading(true);
    try {
      const signed = await getUploadUrl({
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
      onChange(signed.storageKey);
      setPreview(URL.createObjectURL(file));
      setHasImage(true);
      setOriginal(source);
      toast({ title: "Image uploaded", variant: "success" });
    } catch (error) {
      surfaceError(
        toast,
        error,
        "Couldn't upload the image. Object storage may not be configured in this environment.",
      );
    } finally {
      setUploading(false);
    }
  }

  function clearImage(): void {
    onChange(null);
    setPreview(null);
    setHasImage(false);
    setOriginal(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <span className="text-sm font-medium text-fg">{label}</span>

      {adjust ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" data-testid={`${testId}-adjust`}>
          <div
            role="application"
            aria-label="Adjust image position. Drag to move the image inside the frame."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative mx-auto touch-none cursor-move select-none overflow-hidden rounded-md border border-border bg-card"
            style={{ width: VIEWPORT_W, height: viewportH }}
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
              data-testid={`${testId}-zoom`}
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdjust(null)} data-testid={`${testId}-cancel`}>
              Cancel
            </Button>
            <Button type="button" size="sm" loading={uploading} onClick={() => void applyAdjust()} data-testid={`${testId}-apply`}>
              Apply image
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface"
            style={{ width: 128, height: Math.round(128 / aspect) }}
          >
            {preview ? (
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <ImageIcon aria-hidden="true" className="size-7 text-fg-subtle" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED.join(",")}
              className="sr-only"
              data-testid={`${testId}-input`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) beginAdjust(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
              data-testid={`${testId}-pick`}
            >
              <Upload aria-hidden="true" className="size-4" />
              {hasImage ? "Replace image" : "Upload image"}
            </Button>
            {original ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => beginAdjust(original)} data-testid={`${testId}-adjust-open`}>
                <CropIcon aria-hidden="true" className="size-4" />
                Adjust
              </Button>
            ) : null}
            {hasImage ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearImage} data-testid={`${testId}-remove`}>
                <X aria-hidden="true" className="size-4" />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {helperText ? <p className="text-xs text-fg-subtle">{helperText}</p> : null}
    </div>
  );
}
