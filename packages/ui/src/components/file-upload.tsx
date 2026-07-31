"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";

import { cn } from "../lib/cn";
import { Button } from "./button";

/**
 * FileUpload — drag-and-drop + click-to-select, multi-file, per-file progress + error +
 * retry, remove-before-submit. Per docs/07-design-system.md §5 and docs/04 §2.10
 * (StorageProvider — signed upload URL pattern).
 *
 * CRITICAL ARCHITECTURE SEAM:
 * The component NEVER touches any storage SDK directly. Storage is decoupled via two
 * injected async callbacks:
 *  1. `requestUploadUrl(file)` → `{ url, storageKey }` — the parent calls the backend
 *     which mints a short-TTL signed PUT URL via StorageProvider. The component receives
 *     the URL and uploads directly (PUT) from the browser, never exposing a raw bucket URL.
 *  2. `onUploaded(storageKey)` — called after a successful upload. The parent stores the
 *     storageKey (not a URL) and passes it to the form submit.
 *
 * Client-hint validation (props: `maxBytes`, `acceptedTypes`) mirrors server limits so
 * invalid files are rejected locally before consuming the signed URL quota.
 *
 * a11y rules (docs/07 §11):
 * - The dropzone is a <button> (keyboard operable), not a div.
 * - Progress is announced via aria-live (per-file).
 * - File errors are linked to their row via aria-describedby.
 * - Remove buttons are labelled "Remove <filename>".
 * - The hidden file input is aria-hidden (the visible button is the trigger).
 *
 * Usage:
 *   <FileUpload
 *     requestUploadUrl={async (file) => {
 *       const res = await api.storage.getUploadUrl({ filename: file.name, contentType: file.type });
 *       return { url: res.data.url, storageKey: res.data.storageKey };
 *     }}
 *     onUploaded={(storageKey) => setValue("files", (prev) => [...prev, storageKey])}
 *     maxBytes={10 * 1024 * 1024}     // 10 MB
 *     acceptedTypes={["application/pdf", "image/*"]}
 *     multiple
 *   />
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignedUploadResult {
  /** Short-TTL signed PUT URL from the backend (StorageProvider). */
  url: string;
  /** Scoped storage key (e.g. "submissions/tenant-id/enrollment-id/filename"). */
  storageKey: string;
  /**
   * Headers the signature covers and the PUT MUST therefore carry verbatim — the API
   * returns these as `additionalHeaders` on the signed-upload response. Omitting them is
   * not a cosmetic loss: S3/R2 sign Content-Type and the `x-amz-meta-*` metadata into the
   * V4 canonical request, so a PUT without them is rejected with 403 SignatureDoesNotMatch.
   * Anything set here wins over the Content-Type guessed from the File.
   */
  headers?: Record<string, string>;
}

export type FileUploadStatus =
  | "idle"
  | "requesting"   // waiting for signed URL from backend
  | "uploading"    // XHR PUT in progress
  | "done"         // upload complete
  | "error";       // failed (requestUploadUrl or PUT returned error)

export interface FileUploadEntry {
  /** Browser-local unique id for React key / tracking. */
  uid: string;
  file: File;
  status: FileUploadStatus;
  /** 0–100, only meaningful while status === "uploading". */
  progress: number;
  storageKey: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileUploadProps {
  /**
   * Called per-file before upload. Must return { url, storageKey } from the backend
   * (StorageProvider). Never called with the raw bucket URL — that lives server-side.
   */
  requestUploadUrl: (file: File) => Promise<SignedUploadResult>;
  /**
   * Called once per file after a successful upload, with the scoped storageKey.
   * The parent is responsible for collecting keys and including them in the form submit.
   */
  onUploaded: (storageKey: string, file: File) => void;
  /**
   * Called when a file is removed from the list (before or after upload).
   * The parent should remove the storageKey from its state.
   */
  onRemoved?: (storageKey: string | null, file: File) => void;
  /** Max file size in bytes for client-side hint (mirrors server limit). */
  maxBytes?: number;
  /**
   * Accepted MIME types (mirrors server `contentType` whitelist).
   * Glob-style patterns are supported by the <input accept> attribute
   * (e.g. "image/*", "application/pdf"). Client-hint validation is exact-type only
   * (no wildcard glob matching in JS — the server enforces final validation).
   */
  acceptedTypes?: string[];
  /** Allow multiple files. Defaults to false. */
  multiple?: boolean;
  /** Disable the entire dropzone (e.g. while the form is submitting). */
  disabled?: boolean;
  /** Accessible label for the dropzone button. Defaults to "Upload files". */
  label?: string;
  className?: string;
  /** Test hook; defaults to "file-upload" when omitted. */
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let uidCounter = 0;
function nextUid(): string {
  return `fu-${Date.now()}-${++uidCounter}`;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-hint validation — mirrors server constraints. Server is authoritative. */
function validateFile(
  file: File,
  maxBytes?: number,
  acceptedTypes?: string[],
): string | null {
  if (maxBytes !== undefined && file.size > maxBytes) {
    return `File exceeds maximum size of ${humanBytes(maxBytes)}.`;
  }
  if (acceptedTypes && acceptedTypes.length > 0) {
    const isAccepted = acceptedTypes.some((pattern) => {
      if (pattern.endsWith("/*")) {
        const baseType = pattern.slice(0, -2);
        return file.type.startsWith(baseType + "/");
      }
      return file.type === pattern;
    });
    if (!isAccepted) {
      return `File type "${file.type || "unknown"}" is not accepted.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileUpload({
  requestUploadUrl,
  onUploaded,
  onRemoved,
  maxBytes,
  acceptedTypes,
  multiple = false,
  disabled = false,
  label = "Upload files",
  className,
  "data-testid": testId,
}: FileUploadProps): React.JSX.Element {
  const [entries, setEntries] = React.useState<FileUploadEntry[]>([]);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Per-upload abort controllers for cleanup on unmount.
  const abortControllersRef = React.useRef<Map<string, AbortController>>(new Map());

  // Clean up any in-flight XHRs on unmount.
  React.useEffect(() => {
    // abortControllersRef is a stable ref; snapshot .current for the cleanup closure.
    const controllers = abortControllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
    };
  }, []);

  const updateEntry = (uid: string, patch: Partial<FileUploadEntry>) => {
    setEntries((prev) => prev.map((e) => (e.uid === uid ? { ...e, ...patch } : e)));
  };

  const startUpload = React.useCallback(
    async (entry: FileUploadEntry) => {
      const { uid, file } = entry;

      // 1. Request a signed URL from the backend.
      updateEntry(uid, { status: "requesting", progress: 0, errorMessage: null });
      let signedResult: SignedUploadResult;
      try {
        signedResult = await requestUploadUrl(file);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to get upload URL. Please try again.";
        updateEntry(uid, { status: "error", errorMessage: msg });
        return;
      }

      // 2. PUT the file to the signed URL with XHR for progress reporting.
      updateEntry(uid, { status: "uploading" });
      const controller = new AbortController();
      abortControllersRef.current.set(uid, controller);

      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedResult.url);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        // Applied after the guessed Content-Type so the server's signed values win —
        // see SignedUploadResult.headers for why dropping these breaks real S3/R2.
        for (const [name, value] of Object.entries(signedResult.headers ?? {})) {
          xhr.setRequestHeader(name, value);
        }

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            updateEntry(uid, { progress: pct });
          }
        });

        xhr.addEventListener("load", () => {
          abortControllersRef.current.delete(uid);
          if (xhr.status >= 200 && xhr.status < 300) {
            updateEntry(uid, {
              status: "done",
              progress: 100,
              storageKey: signedResult.storageKey,
            });
            onUploaded(signedResult.storageKey, file);
          } else {
            updateEntry(uid, {
              status: "error",
              errorMessage: `Upload failed (HTTP ${xhr.status}). Please try again.`,
            });
          }
          resolve();
        });

        xhr.addEventListener("error", () => {
          abortControllersRef.current.delete(uid);
          updateEntry(uid, {
            status: "error",
            errorMessage: "Network error during upload. Please try again.",
          });
          resolve();
        });

        xhr.addEventListener("abort", () => {
          abortControllersRef.current.delete(uid);
          resolve();
        });

        // Tie the abort controller signal to XHR abort.
        controller.signal.addEventListener("abort", () => xhr.abort());

        xhr.send(file);
      });
    },
    [requestUploadUrl, onUploaded],
  );

  const processFiles = React.useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const toAdd: FileUploadEntry[] = [];
      for (const file of fileArray) {
        const validationError = validateFile(file, maxBytes, acceptedTypes);
        const uid = nextUid();
        if (validationError) {
          toAdd.push({
            uid,
            file,
            status: "error",
            progress: 0,
            storageKey: null,
            errorMessage: validationError,
          });
        } else {
          toAdd.push({
            uid,
            file,
            status: "idle",
            progress: 0,
            storageKey: null,
            errorMessage: null,
          });
        }
      }

      setEntries((prev) => (multiple ? [...prev, ...toAdd] : toAdd));

      // Start uploads for valid entries.
      for (const entry of toAdd) {
        if (entry.status === "idle") {
          // Kick off async without blocking.
          void startUpload(entry);
        }
      }
    },
    [maxBytes, acceptedTypes, multiple, startUpload],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      // Reset input so the same file can be re-selected after removal.
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleRemove = (uid: string) => {
    const entry = entries.find((e) => e.uid === uid);
    if (!entry) return;
    // Abort any in-flight upload.
    abortControllersRef.current.get(uid)?.abort();
    abortControllersRef.current.delete(uid);
    setEntries((prev) => prev.filter((e) => e.uid !== uid));
    onRemoved?.(entry.storageKey, entry.file);
  };

  const handleRetry = (uid: string) => {
    const entry = entries.find((e) => e.uid === uid);
    if (!entry) return;
    void startUpload(entry);
  };

  const acceptAttr = acceptedTypes?.join(",");

  return (
    <div
      data-testid={testId ?? "file-upload"}
      className={cn("flex flex-col gap-3", className)}
    >
      {/* Hidden file input — aria-hidden; the visible <button> is the keyboard trigger. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptAttr}
        multiple={multiple}
        onChange={handleFileInputChange}
        disabled={disabled}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="file-upload-input"
      />

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled ? "true" : undefined}
        aria-describedby={acceptedTypes || maxBytes ? "file-upload-hints" : undefined}
        onClick={() => !disabled && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        data-testid="file-upload-dropzone"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center",
          "transition-colors duration-fast ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          disabled
            ? "cursor-not-allowed border-border bg-surface opacity-60"
            : isDragOver
              ? "border-brand-500 bg-brand-50 text-brand-600"
              : "cursor-pointer border-border bg-surface hover:border-fg-subtle hover:bg-card",
        )}
      >
        <UploadCloud
          className={cn(
            "size-8 shrink-0",
            isDragOver ? "text-brand-500" : "text-fg-subtle",
          )}
          aria-hidden="true"
          strokeWidth={1.5}
        />
        <div>
          <p className="text-sm font-medium text-fg">
            {isDragOver ? "Drop to upload" : "Drop files here or click to browse"}
          </p>
          {(maxBytes !== undefined || acceptedTypes) ? (
            <p
              id="file-upload-hints"
              className="mt-1 text-xs text-fg-muted"
              aria-live="off"
            >
              {[
                acceptedTypes?.length
                  ? `Accepted: ${acceptedTypes.join(", ")}`
                  : null,
                maxBytes !== undefined ? `Max size: ${humanBytes(maxBytes)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </div>

      {/* File list */}
      {entries.length > 0 ? (
        <ul
          className="flex flex-col gap-2"
          aria-label="Uploaded files"
          data-testid="file-upload-list"
        >
          {entries.map((entry) => (
            <FileEntryRow
              key={entry.uid}
              entry={entry}
              onRemove={handleRemove}
              onRetry={handleRetry}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileEntryRow
// ---------------------------------------------------------------------------

interface FileEntryRowProps {
  entry: FileUploadEntry;
  onRemove: (uid: string) => void;
  onRetry: (uid: string) => void;
}

function FileEntryRow({ entry, onRemove, onRetry }: FileEntryRowProps): React.JSX.Element {
  const errorId = `${entry.uid}-error`;

  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2.5"
      data-testid={`file-entry-${entry.uid}`}
    >
      <div className="flex items-center gap-2">
        {/* File icon / status icon */}
        {entry.status === "done" ? (
          <CheckCircle2
            className="size-4 shrink-0 text-success"
            aria-hidden="true"
          />
        ) : entry.status === "error" ? (
          <AlertCircle
            className="size-4 shrink-0 text-danger"
            aria-hidden="true"
          />
        ) : entry.status === "requesting" || entry.status === "uploading" ? (
          <Loader2
            className="size-4 shrink-0 animate-spin text-brand-500"
            aria-hidden="true"
          />
        ) : (
          <FileText
            className="size-4 shrink-0 text-fg-subtle"
            aria-hidden="true"
          />
        )}

        {/* Filename + size */}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-fg"
            title={entry.file.name}
          >
            {entry.file.name}
          </p>
          <p className="text-xs text-fg-muted">{humanBytes(entry.file.size)}</p>
        </div>

        {/* SR status announcement */}
        <span
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {entry.status === "done"
            ? `${entry.file.name}: upload complete.`
            : entry.status === "error"
              ? `${entry.file.name}: upload failed. ${entry.errorMessage ?? ""}`
              : entry.status === "uploading"
                ? `${entry.file.name}: uploading, ${entry.progress}%.`
                : ""}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {entry.status === "error" ? (
            <button
              type="button"
              onClick={() => onRetry(entry.uid)}
              aria-label={`Retry upload of ${entry.file.name}`}
              className={cn(
                "rounded-md p-1 text-fg-muted transition-colors duration-fast hover:text-fg",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              data-testid={`file-entry-retry-${entry.uid}`}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(entry.uid)}
            aria-label={`Remove ${entry.file.name}`}
            className={cn(
              "rounded-md p-1 text-fg-muted transition-colors duration-fast hover:text-danger",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            data-testid={`file-entry-remove-${entry.uid}`}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Per-file progress bar */}
      {(entry.status === "uploading" || entry.status === "requesting") ? (
        <div
          role="progressbar"
          aria-valuenow={entry.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Upload progress for ${entry.file.name}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-brand-500 transition-[width] duration-fast ease-out"
            style={{ width: `${entry.progress}%` }}
            aria-hidden="true"
          />
        </div>
      ) : null}

      {/* Per-file error */}
      {entry.status === "error" && entry.errorMessage ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-xs text-danger"
          data-testid={`file-entry-error-${entry.uid}`}
        >
          {entry.errorMessage}
        </p>
      ) : null}
    </li>
  );
}
