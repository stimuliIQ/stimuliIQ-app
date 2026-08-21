"use client";

/**
 * Modal — a general-purpose, accessible centred dialog.
 *
 * The design system already had three dialogs, and all three are purpose-built: `Drawer`
 * slides from the edge and is the CRM's record-editing surface, `ConfirmDialog` asks one
 * yes/no question, and `ExitIntentModal` is a lead-capture card with fixed copy. None of
 * them is "put this arbitrary content in a centred box", which is what a marketing-site
 * flow like the careers apply form needs — so that flow would otherwise have hand-rolled a
 * fourth dialog in `apps/web`, with its own focus trap and its own escape handling to get
 * subtly wrong.
 *
 * Built on Radix Dialog, so focus trapping, focus restore, Escape, scroll locking and the
 * `aria-modal`/labelling wiring are the library's job rather than ours.
 *
 * SCROLLING IS INSIDE THE MODAL, not the page: `max-h-[calc(100svh-2rem)]` with the body
 * scrolling means a long form on a short phone screen stays reachable with its header and
 * close button pinned. `svh` rather than `vh` because mobile browser chrome makes `vh`
 * taller than the visible viewport, which pushes the bottom of a form under the URL bar.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "../lib/cn";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name. Rendered visibly unless `hideHeader`. */
  title: string;
  /** Optional supporting line under the title. */
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Footer content pinned below the scrolling body (e.g. submit/cancel). */
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Visually hides the header while keeping it for screen readers. */
  hideHeader?: boolean;
  className?: string;
  "data-testid"?: string;
}

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideHeader = false,
  className,
  "data-testid": testId,
}: ModalProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-fg/50 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out",
          )}
        />
        <DialogPrimitive.Content
          data-testid={testId ?? "modal"}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "max-h-[calc(100svh-2rem)] rounded-2xl border border-border bg-card shadow-lg",
            SIZE[size],
            "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
            "focus-visible:outline-none",
            className,
          )}
        >
          <div className={cn("flex items-start justify-between gap-4 px-6 pt-6", hideHeader && "sr-only")}>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold text-fg">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-fg-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                // Radix warns when a dialog has no description; an empty one is the
                // documented way to say "there deliberately isn't one".
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            {!hideHeader ? (
              <DialogPrimitive.Close
                aria-label="Close"
                className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

          {footer ? <div className="border-t border-border px-6 py-4">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

Modal.displayName = "Modal";
