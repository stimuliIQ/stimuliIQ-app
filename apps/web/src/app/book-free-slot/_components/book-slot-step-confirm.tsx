"use client";

/**
 * Step 3 — Confirmation summary before submitting.
 * Shows what the user has entered so they can review before booking.
 */

import type { BookSlotFormData } from "../../../hooks/use-book-slot";

interface ConfirmStepProps {
  formData: BookSlotFormData;
}

function formatSlot(isoString?: string): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}

export function ConfirmStep({ formData }: ConfirmStepProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="book-slot-step-confirm">
      <p className="text-sm text-fg-muted">
        Please review your booking details. Click &ldquo;Book My Slot&rdquo; to confirm.
      </p>

      <dl className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        {formData.programLabel ? (
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="min-w-[120px] font-medium text-fg shrink-0">Program</dt>
            <dd className="text-fg-muted">{formData.programLabel}</dd>
          </div>
        ) : null}

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="min-w-[120px] font-medium text-fg shrink-0">Date &amp; Time</dt>
          <dd className="text-fg-muted">{formatSlot(formData.slotAt)}</dd>
        </div>

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="min-w-[120px] font-medium text-fg shrink-0">Name</dt>
          <dd className="text-fg-muted">{formData.name}</dd>
        </div>

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="min-w-[120px] font-medium text-fg shrink-0">Phone</dt>
          <dd className="text-fg-muted">{formData.phone}</dd>
        </div>

        {formData.email ? (
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="min-w-[120px] font-medium text-fg shrink-0">Email</dt>
            <dd className="text-fg-muted">{formData.email}</dd>
          </div>
        ) : null}

        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
          <dt className="min-w-[120px] font-medium text-fg shrink-0">Updates</dt>
          <dd className="text-fg-muted">
            {formData.marketingOptIn ? "Opted in to marketing communications" : "Essential communications only"}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-fg-subtle">
        A counsellor will call you at the selected time. You&apos;ll also receive a
        confirmation by email. No spam, ever.
      </p>
    </div>
  );
}
