"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "../lib/cn";
import { Button, type ButtonProps } from "./button";

/**
 * ConfirmDialog — destructive-action confirmation, per docs/07-design-system.md §6
 * ("confirm + undo on destructive actions") and docs/03 §11. Built on Radix AlertDialog
 * (not Dialog) because it enforces an explicit confirm/cancel choice — ESC and overlay
 * click map to cancel, focus returns to the trigger on close, and the description is
 * announced to screen readers as part of the alert.
 *
 * Controlled usage (no trigger — open programmatically, e.g. from a row action menu):
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Delete student?"
 *     description="This soft-deletes the record. You can restore it later from the audit log."
 *     confirmLabel="Delete"
 *     tone="danger"
 *     onConfirm={() => deleteStudent(id)}
 *   />
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button destructively (delete/revoke); "default" is neutral. */
  tone?: "default" | "danger";
  onConfirm: () => void;
  /** Reflects an in-flight confirm action (disables both buttons, shows a spinner). */
  loading?: boolean;
  /** Test hook; defaults to "confirm-dialog" when omitted. */
  "data-testid"?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  loading = false,
  "data-testid": testId,
}: ConfirmDialogProps): React.JSX.Element {
  const confirmVariant: ButtonProps["variant"] = tone === "danger" ? "destructive" : "primary";

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-fg/40",
            "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-base",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-fast",
          )}
        />
        <AlertDialogPrimitive.Content
          data-testid={testId ?? "confirm-dialog"}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border bg-card p-6 text-fg shadow-md",
            "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-base",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-fast",
            "focus-visible:outline-none",
          )}
        >
          <AlertDialogPrimitive.Title className="text-lg font-semibold leading-heading text-fg">
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description className="mt-2 text-sm text-fg-muted">
              {description}
            </AlertDialogPrimitive.Description>
          ) : null}
          <div className="mt-6 flex items-center justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" disabled={loading} data-testid="confirm-dialog-cancel">
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                variant={confirmVariant}
                loading={loading}
                data-testid="confirm-dialog-confirm"
                onClick={(event) => {
                  // Prevent Radix's default close-on-action so the caller can keep the
                  // dialog open (e.g. while `loading`) and close it once the async action
                  // settles via `onOpenChange(false)`.
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
