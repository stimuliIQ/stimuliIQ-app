"use client";

import * as React from "react";
import { ImageIcon, Type } from "lucide-react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { Input } from "./input";
import { Skeleton } from "./skeleton";

/**
 * CertTemplateCanvas — certificate-template designer: positioned text/image fields over a
 * background image (T19, docs/plans/phase-9-completion.md — CRM certificate template
 * designer + bulk issuance).
 *
 * POSITIONING APPROACH (mirrors the Kanban "no drag-and-drop library" precedent —
 * `./kanban.tsx` — same reasoning: an accessible non-drag control is the primary
 * mechanism, with a DnD seam left for optional consumer opt-in):
 *
 * 1. ACCESSIBLE PRIMARY CONTROL — every field is keyboard-selectable (Tab) and, once
 *    selected, nudgeable with arrow keys (`nudgeStep`% per press, ×5 with Shift). The side
 *    panel additionally exposes exact numeric X/Y % inputs per field — the most robust,
 *    fully keyboard/SR-operable way to position a field precisely, not merely a fallback.
 * 2. DND SEAM — each field marker renders `data-cert-field-id` on its root so a consumer
 *    that wants pointer-drag can attach `@dnd-kit`/pointer-event handlers without needing
 *    any change to this component; the single integration point is `onFieldsChange`.
 *
 * Coordinates are percentages (0-100) of the canvas, not pixels — this keeps templates
 * resolution-independent across the designer preview and the eventual PDF/image render.
 *
 * a11y:
 * - Canvas is `role="group"` with a descriptive `aria-label`.
 * - Each field marker is a `<button>` (keyboard-focusable) with `aria-label` describing
 *   the field, its type, and its current position (announced on selection/move via
 *   `aria-live="polite"`).
 * - Text color (`field.color`) is caller-authored certificate content, not a themed UI
 *   surface — the one documented exception to "tokens only" in docs/07 §2, matching how
 *   `TestimonialCard`/marketing content already accepts author-supplied media.
 *
 * Usage:
 *   <CertTemplateCanvas
 *     backgroundUrl={template.backgroundUrl}
 *     fields={template.fields}
 *     selectedFieldId={selectedId}
 *     onSelectField={setSelectedId}
 *     onFieldsChange={setFields}
 *   />
 */
export type CertFieldType = "text" | "image";

export interface CertTemplateField {
  id: string;
  type: CertFieldType;
  label: string;
  /** Position as a percentage of canvas width/height (0-100). */
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  /** Caller-authored certificate text color (hex) — see module doc's tokens-only exception. */
  color?: string;
  align?: "left" | "center" | "right";
  fontWeight?: "normal" | "bold";
  /** Sample/merge-tag text shown on the canvas, e.g. "{{student_name}}". */
  placeholder?: string;
  imageUrl?: string;
}

export interface CertTemplateCanvasProps {
  backgroundUrl?: string;
  backgroundAlt?: string;
  fields: CertTemplateField[];
  selectedFieldId?: string | null;
  onSelectField?: (fieldId: string | null) => void;
  onFieldsChange?: (fields: CertTemplateField[]) => void;
  /** Nudge step in percentage points per arrow-key press; Shift multiplies by 5. Default 0.5. */
  nudgeStep?: number;
  readOnly?: boolean;
  loading?: boolean;
  className?: string;
  /** Test hook; defaults to "cert-template-canvas" when omitted. */
  "data-testid"?: string;
}

export function CertTemplateCanvas({
  backgroundUrl,
  backgroundAlt = "Certificate background",
  fields,
  selectedFieldId = null,
  onSelectField,
  onFieldsChange,
  nudgeStep = 0.5,
  readOnly = false,
  loading = false,
  className,
  "data-testid": testId,
}: CertTemplateCanvasProps): React.JSX.Element {
  const [announcement, setAnnouncement] = React.useState("");
  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;

  function updateField(fieldId: string, patch: Partial<CertTemplateField>): void {
    if (!onFieldsChange) return;
    const next = fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
    onFieldsChange(next);
  }

  function clamp(value: number): number {
    return Math.min(100, Math.max(0, value));
  }

  function handleFieldKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, field: CertTemplateField): void {
    if (readOnly) return;
    const step = e.shiftKey ? nudgeStep * 5 : nudgeStep;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case "ArrowLeft":
        dx = -step;
        break;
      case "ArrowRight":
        dx = step;
        break;
      case "ArrowUp":
        dy = -step;
        break;
      case "ArrowDown":
        dy = step;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextX = clamp(field.x + dx);
    const nextY = clamp(field.y + dy);
    updateField(field.id, { x: nextX, y: nextY });
    setAnnouncement(`${field.label} moved to ${nextX.toFixed(1)}%, ${nextY.toFixed(1)}%`);
  }

  if (loading) {
    return (
      <div data-testid={testId ?? "cert-template-canvas"} aria-busy="true" aria-label="Loading template" className={cn("flex flex-col gap-3", className)}>
        <Skeleton shape="block" className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div data-testid={testId ?? "cert-template-canvas"} className={cn("flex flex-col gap-4 md:flex-row", className)}>
      {/* Live region for keyboard-nudge announcements */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      {/* Canvas */}
      <div
        role="group"
        aria-label="Certificate canvas"
        data-testid="cert-canvas-surface"
        className="relative aspect-[1.414/1] w-full flex-1 overflow-hidden rounded-md border border-border bg-surface"
      >
        {backgroundUrl ? (
          <img src={backgroundUrl} alt={backgroundAlt} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0">
            <EmptyState title="No background uploaded" description="Upload a certificate background to start positioning fields." />
          </div>
        )}

        {fields.map((field) => {
          const isSelected = field.id === selectedFieldId;
          return (
            <button
              key={field.id}
              type="button"
              data-cert-field-id={field.id}
              data-testid={`cert-field-${field.id}`}
              onClick={() => onSelectField?.(field.id)}
              onKeyDown={(e) => handleFieldKeyDown(e, field)}
              aria-label={`${field.label} (${field.type} field), positioned at ${field.x.toFixed(1)}% from left, ${field.y.toFixed(1)}% from top${isSelected ? ", selected" : ""}`}
              aria-pressed={isSelected}
              style={{
                left: `${field.x}%`,
                top: `${field.y}%`,
                color: field.type === "text" ? field.color : undefined,
                fontSize: field.type === "text" && field.fontSize ? `${field.fontSize}px` : undefined,
                fontWeight: field.type === "text" ? field.fontWeight : undefined,
                textAlign: field.type === "text" ? field.align : undefined,
              }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-dashed px-1.5 py-0.5 text-xs",
                "bg-card/70 backdrop-blur-[1px]",
                isSelected ? "border-brand-500 ring-2 ring-brand-500 ring-offset-1" : "border-border/60 hover:border-fg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {field.type === "text" ? (
                <span className="inline-flex items-center gap-1">
                  <Type aria-hidden="true" className="size-3 shrink-0" />
                  {field.placeholder ?? field.label}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <ImageIcon aria-hidden="true" className="size-3 shrink-0" />
                  {field.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Field list + precise position panel — the primary keyboard/SR-operable control */}
      <div className="flex w-full flex-col gap-3 md:w-64 md:shrink-0">
        <h3 className="text-sm font-semibold text-fg">Fields</h3>
        {fields.length === 0 ? (
          <p className="text-sm text-fg-muted">No fields yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label="Certificate fields">
            {fields.map((field) => {
              const isSelected = field.id === selectedFieldId;
              return (
                <li key={field.id}>
                  <button
                    type="button"
                    onClick={() => onSelectField?.(field.id)}
                    aria-pressed={isSelected}
                    data-testid={`cert-field-list-item-${field.id}`}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm",
                      isSelected ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-border text-fg hover:bg-surface",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <span>{field.label}</span>
                    <span className="text-xs text-fg-muted">{field.type}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selectedField ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3" disabled={readOnly}>
            <legend className="px-1 text-xs font-medium text-fg-muted">{selectedField.label} position</legend>
            <div className="flex gap-2">
              <Input
                label="X (%)"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={selectedField.x}
                onChange={(e) => updateField(selectedField.id, { x: clamp(Number(e.target.value)) })}
                data-testid="cert-field-x-input"
                wrapperClassName="flex-1"
              />
              <Input
                label="Y (%)"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={selectedField.y}
                onChange={(e) => updateField(selectedField.id, { y: clamp(Number(e.target.value)) })}
                data-testid="cert-field-y-input"
                wrapperClassName="flex-1"
              />
            </div>
          </fieldset>
        ) : null}
      </div>
    </div>
  );
}

CertTemplateCanvas.displayName = "CertTemplateCanvas";
