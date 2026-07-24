"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva } from "class-variance-authority";
import { CheckCircle2, X, XCircle, Info } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Toast — queueable transient notification (success/error/info) per
 * docs/07-design-system.md §5. Built on Radix Toast for focus-management,
 * swipe-to-dismiss, and screen-reader announcement semantics.
 *
 * Usage:
 *   // once, near the app root:
 *   <ToastProvider />
 *
 *   // anywhere:
 *   const { toast } = useToast();
 *   toast({ title: "Saved", description: "Your changes were saved.", variant: "success" });
 */

const toastVariants = cva(
  [
    "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-md border p-4 shadow-md",
    "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]",
    "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none",
    "data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full data-[state=open]:duration-base",
    "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-fast",
  ].join(" "),
  {
    variants: {
      variant: {
        success: "border-success/30 bg-card text-fg",
        destructive: "border-danger/30 bg-card text-fg",
        info: "border-info/30 bg-card text-fg",
        default: "border-border bg-card text-fg",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface ToastItem {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "success" | "destructive" | "info";
  duration?: number;
}

type ToastVariant = NonNullable<ToastItem["variant"]>;

const variantIcon: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  destructive: XCircle,
  info: Info,
  default: Info,
};

const variantIconClass: Record<ToastVariant, string> = {
  success: "text-success",
  destructive: "text-danger",
  info: "text-info",
  default: "text-fg-muted",
};

type ToastInput = Omit<ToastItem, "id">;

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `toast-${idCounter}-${Date.now()}`;
}

/**
 * ToastProvider — mount once near the app root. Renders the Radix viewport and
 * owns the toast queue; consumed via `useToast()`.
 */
export function ToastProvider({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((input: ToastInput) => {
    const id = nextId();
    setToasts((current) => [...current, { id, ...input }]);
    return id;
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => {
          const Icon = variantIcon[t.variant ?? "default"];
          return (
            <ToastPrimitive.Root
              key={t.id}
              data-testid="toast"
              duration={t.duration ?? 5000}
              className={toastVariants({ variant: t.variant })}
              onOpenChange={(open) => {
                if (!open) dismiss(t.id);
              }}
            >
              <Icon
                aria-hidden="true"
                className={cn("mt-0.5 size-5 shrink-0", variantIconClass[t.variant ?? "default"])}
              />
              <div className="flex-1">
                {t.title ? (
                  <ToastPrimitive.Title className="text-sm font-semibold text-fg">
                    {t.title}
                  </ToastPrimitive.Title>
                ) : null}
                {t.description ? (
                  <ToastPrimitive.Description className="text-sm text-fg-muted">
                    {t.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss notification"
                className={cn(
                  "rounded-md p-1 text-fg-subtle transition-colors duration-fast hover:text-fg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <X className="size-4" aria-hidden="true" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        {/* Top-right (matches the slide-in-from-top animation). Deliberately NOT
            bottom-anchored: drawers put their primary actions in a bottom footer,
            and a bottom-right toast lands under the cursor that just clicked
            them — Radix pauses the dismiss timer while hovered, so the toast
            never left and blocked the buttons. */}
        <ToastPrimitive.Viewport
          data-testid="toast-viewport"
          className={cn(
            "fixed right-0 top-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4",
            "sm:right-0 sm:top-0 sm:max-w-[420px]",
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** useToast — imperative API: `const { toast, dismiss } = useToast();` */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
