"use client";

/**
 * Step 0 — Program Selection.
 * Let the user pick the program they're interested in (optional).
 */

import { useId } from "react";
import type { BookSlotFormData } from "../../../hooks/use-book-slot";

/** A selectable program — real CRM catalog entry (`id` is the program UUID). */
export interface ProgramOption {
  id: string;
  title: string;
}

interface ProgramStepProps {
  formData: BookSlotFormData;
  onChange: (data: Partial<BookSlotFormData>) => void;
  errors: Record<string, string>;
  /** Live programs from the CRM catalog (GET /public/programs). Empty → only "Not sure yet". */
  programs: ProgramOption[];
}

export function ProgramStep({ formData, onChange, errors, programs }: ProgramStepProps) {
  const selectId = useId();

  return (
    <div className="flex flex-col gap-4" data-testid="book-slot-step-program">
      <p className="text-sm text-fg-muted">
        Tell us which program you're interested in (optional — you can choose later).
      </p>

      <div>
        <label
          htmlFor={selectId}
          className="mb-1.5 block text-sm font-medium text-fg"
        >
          Program of interest
          <span className="ml-1 text-fg-subtle text-xs">(optional)</span>
        </label>
        <select
          id={selectId}
          value={formData.programId ?? ""}
          onChange={(e) => {
            const selected = programs.find((p) => p.id === e.target.value);
            onChange({
              programId: e.target.value || undefined,
              programLabel: selected?.title,
            });
          }}
          aria-describedby={errors.programId ? `${selectId}-error` : undefined}
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">Not sure yet</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        {errors.programId ? (
          <p id={`${selectId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.programId}
          </p>
        ) : null}
      </div>

      {formData.programLabel ? (
        <p className="text-sm text-brand-500 font-medium">
          Selected: {formData.programLabel}
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          Don't see your program? Our counsellors cover all programs.
        </p>
      )}
    </div>
  );
}
