"use client";

/**
 * CareerApplyModal — the apply form in a dialog, opened from the Apply buttons on a role's
 * detail page.
 *
 * A modal rather than an inline panel because the detail page is long: the Apply buttons sit
 * at the top AND the bottom, and either has to lead somewhere immediately. Expanding a form
 * in place would mean the top button scrolls you past the whole advert to reach it, and the
 * bottom one pushes the footer around while you type.
 *
 * The role's title is in the dialog heading, so there is never a question about which job is
 * being applied for — the failure mode of a shared form on a page listing several roles.
 */

import { useState } from "react";
import { Modal } from "@repo/ui";
import type { PublicJobOpening } from "@repo/types";
import { CareerApplyForm } from "./career-apply-form";

export interface CareerApplyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opening: PublicJobOpening;
}

export function CareerApplyModal({ open, onOpenChange, opening }: CareerApplyModalProps) {
  // Remounts the form on each open so a previous success screen, a half-typed note or a
  // spent captcha token never greets the next visitor to this dialog.
  const [instance, setInstance] = useState(0);

  function handleOpenChange(next: boolean) {
    if (!next) setInstance((n) => n + 1);
    onOpenChange(next);
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={`Apply for ${opening.title}`}
      description={`${opening.employmentType} · ${opening.location}`}
      size="lg"
      data-testid="career-apply-modal"
    >
      <CareerApplyForm
        key={instance}
        jobOpeningId={opening.id}
        role={opening.title}
        onClose={() => handleOpenChange(false)}
      />
    </Modal>
  );
}

CareerApplyModal.displayName = "CareerApplyModal";
