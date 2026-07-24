"use client";

/**
 * Step 1 — Date/time slot selection.
 *
 * Renders a set of preset slot options. In production these would come from the
 * booking availability API; in this P5 implementation we generate the next 7 days
 * of available slots client-side (the server accepts any valid ISO datetime for P5;
 * slot capacity is validated server-side → AC-7).
 */

import { useId, useMemo } from "react";
import type { BookSlotFormData } from "../../../hooks/use-book-slot";

interface SlotStepProps {
  formData: BookSlotFormData;
  onChange: (data: Partial<BookSlotFormData>) => void;
  errors: Record<string, string>;
}

interface SlotOption {
  label: string;
  value: string; // ISO-8601 datetime with offset
}

/** Generate available slots for the next 7 days (10 AM and 3 PM IST). */
function generateSlots(): SlotOption[] {
  const slots: SlotOption[] = [];
  const now = new Date();

  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + dayOffset);

    // Skip Sundays
    if (date.getDay() === 0) continue;

    const dayLabel = date.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

    for (const hour of [10, 15]) {
      const slotDate = new Date(date);
      slotDate.setHours(hour, 0, 0, 0);

      const timeLabel = hour === 10 ? "10:00 AM" : "3:00 PM";

      slots.push({
        label: `${dayLabel} · ${timeLabel} IST`,
        value: slotDate.toISOString(),
      });
    }
  }

  return slots;
}

export function SlotStep({ formData, onChange, errors }: SlotStepProps) {
  const radioGroupId = useId();
  const errorId = useId();
  const slots = useMemo(() => generateSlots(), []);

  return (
    <div className="flex flex-col gap-4" data-testid="book-slot-step-slot">
      <p className="text-sm text-fg-muted">
        Pick a date and time that works for you. Our counsellor will call you then.
      </p>

      <fieldset aria-describedby={errors.slotAt ? errorId : undefined}>
        <legend className="mb-3 text-sm font-medium text-fg">
          Available slots
        </legend>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slots.map((slot, index) => {
            const inputId = `${radioGroupId}-slot-${index}`;
            const isSelected = formData.slotAt === slot.value;

            return (
              <label
                key={slot.value}
                htmlFor={inputId}
                className={[
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
                  "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  isSelected
                    ? "border-brand-500 bg-brand-50 text-brand-700 font-medium"
                    : "border-border bg-card text-fg hover:bg-surface",
                ].join(" ")}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={`${radioGroupId}-slot`}
                  value={slot.value}
                  checked={isSelected}
                  onChange={() => onChange({ slotAt: slot.value })}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={[
                    "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                    isSelected
                      ? "border-brand-500 bg-brand-500"
                      : "border-border bg-card",
                  ].join(" ")}
                >
                  {isSelected ? (
                    <span className="size-1.5 rounded-full bg-white" />
                  ) : null}
                </span>
                {slot.label}
              </label>
            );
          })}
        </div>

        {errors.slotAt ? (
          <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
            {errors.slotAt}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
