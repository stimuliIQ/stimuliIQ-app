"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Checkbox — small Radix Checkbox wrapper used by DataTable row/header selection. Exposed
 * standalone since forms (e.g. permission-matrix grid) need it too.
 */
export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  "data-testid"?: string;
}

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, "data-testid": testId, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-testid={testId ?? "checkbox"}
    className={cn(
      "peer size-4 shrink-0 rounded-sm border border-border bg-bg",
      "transition-colors duration-fast ease-out",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-brand-500 data-[state=checked]:bg-brand-500 data-[state=checked]:text-brand-foreground",
      "data-[state=indeterminate]:border-brand-500 data-[state=indeterminate]:bg-brand-500 data-[state=indeterminate]:text-brand-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {props.checked === "indeterminate" ? (
        <Minus className="size-3" aria-hidden="true" />
      ) : (
        <Check className="size-3" aria-hidden="true" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
