"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Drawer — overlay panel built on Radix Dialog (focus-trap, ESC close, overlay-click
 * close, return-focus-on-close for free). Two positions:
 *
 *   - `position="side"` (default): right-side panel for DETAIL views (CRM
 *     list+detail-drawer pattern, docs/07-design-system.md §6) — the list context
 *     behind stays visible.
 *   - `position="center"`: centered modal for FORMS (create/edit/convert flows) —
 *     data entry reads better with width + focus in the middle of the screen, and
 *     stays fully responsive (width caps at calc(100vw-2rem), height at 85dvh with
 *     the body scrolling internally).
 *
 * Use `Dialog`-style ConfirmDialog for short confirmations.
 *
 * Usage:
 *   <Drawer open={open} onOpenChange={setOpen}>
 *     <DrawerContent title="Aditi Sharma" description="Student profile">
 *       <DrawerBody>...</DrawerBody>
 *       <DrawerFooter>
 *         <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
 *       </DrawerFooter>
 *     </DrawerContent>
 *   </Drawer>
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const drawerContentVariants = cva(
  ["z-50 flex flex-col bg-card text-fg", "focus-visible:outline-none"].join(" "),
  {
    variants: {
      position: {
        side: [
          "fixed inset-y-0 right-0 h-full border-l border-border shadow-md",
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-base",
          "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-fast",
        ].join(" "),
        center: [
          // Centered, width-capped, never taller than the viewport — DrawerBody
          // (flex-1 overflow-y-auto) scrolls internally on short screens.
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          "max-h-[min(85dvh,52rem)] w-[calc(100vw-2rem)] rounded-lg border border-border shadow-lg",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-base",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-fast",
        ].join(" "),
      },
      size: {
        sm: "",
        md: "",
        lg: "",
        xl: "",
      },
    },
    compoundVariants: [
      // Side panel: full-height sheet, width = the size cap.
      { position: "side", size: "sm", class: "w-full max-w-sm" },
      { position: "side", size: "md", class: "w-full max-w-md" },
      { position: "side", size: "lg", class: "w-full max-w-2xl" },
      { position: "side", size: "xl", class: "w-full max-w-4xl" },
      // Centered modal: one step wider per size — forms get room to breathe,
      // while w-[calc(100vw-2rem)] keeps every size fully responsive on phones.
      { position: "center", size: "sm", class: "max-w-md" },
      { position: "center", size: "md", class: "max-w-xl" },
      { position: "center", size: "lg", class: "max-w-3xl" },
      { position: "center", size: "xl", class: "max-w-5xl" },
    ],
    defaultVariants: { position: "side", size: "md" },
  },
);

export interface DrawerContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title">,
    VariantProps<typeof drawerContentVariants> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Hide the built-in close button (e.g. when the caller renders its own in the header). */
  hideCloseButton?: boolean;
  /**
   * Whether clicking the overlay / pressing Escape closes the panel. When set,
   * it controls BOTH gestures. When left unset (the default), the two are split:
   *   - Outside/overlay click never closes any drawer — a detail panel sits over
   *     a still-visible list and an accidental click on it must not discard the
   *     panel; forms must never lose half-entered input.
   *   - Escape still closes read-only side panels (keyboard-a11y expectation,
   *     WCAG 2.2), but not centered forms (which would lose in-progress data).
   * Net effect: panels close via the X, Cancel, or submit — or Escape on side
   * panels — never a stray click.
   */
  dismissible?: boolean;
  /** Test hook; defaults to "drawer" when omitted. */
  "data-testid"?: string;
}

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(
  (
    {
      className,
      position,
      size,
      title,
      description,
      hideCloseButton,
      dismissible,
      children,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    // Split the two close gestures so a stray click never discards a panel:
    //   - Outside/overlay clicks close nothing by default (the accidental cause).
    //   - Escape still closes read-only side panels for keyboard a11y, but not
    //     centered forms (which would lose in-progress input).
    // An explicit `dismissible` overrides both together.
    const closeOnOutsideClick = dismissible ?? false;
    const closeOnEscape = dismissible ?? position !== "center";
    return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-fg/40",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-base",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-fast",
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        data-testid={testId ?? "drawer"}
        className={cn(drawerContentVariants({ position, size }), className)}
        {...props}
        onInteractOutside={(event) => {
          props.onInteractOutside?.(event);
          if (!closeOnOutsideClick) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          props.onEscapeKeyDown?.(event);
          if (!closeOnEscape) event.preventDefault();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-lg font-semibold leading-heading text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {hideCloseButton ? null : (
            <DialogPrimitive.Close
              aria-label="Close panel"
              className={cn(
                "rounded-md p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface hover:text-fg",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
    );
  },
);
DrawerContent.displayName = "DrawerContent";

export const DrawerBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex-1 overflow-y-auto p-6", className)} {...props} />
  ),
);
DrawerBody.displayName = "DrawerBody";

export const DrawerFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center justify-end gap-2 border-t border-border p-6", className)}
      {...props}
    />
  ),
);
DrawerFooter.displayName = "DrawerFooter";
